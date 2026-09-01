import http from "node:http";
import {randomUUID} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {cases} from "./src/data/cases.js";
import {AutopsyAgent} from "./src/agent.js";
import {normalizeInput,isFixtureKey} from "./src/input.js";
import {createGoldRushTools,GoldRushProvider} from "./src/providers/goldrush.js";
import {createCoinMarketCapTools,CoinMarketCapProvider} from "./src/providers/coinmarketcap.js";
import {createRpcTools,RpcProvider} from "./src/providers/rpc.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const publicDir=path.join(__dirname,"public");
const PORT=Number(process.env.PORT||3000);
const HOST=process.env.HOST||"0.0.0.0";
const jobs=new Map();
const EVM_ADDRESS=/^0x[a-fA-F0-9]{40}$/;
const DEX_TO_GOLDRUSH_CHAIN={
  ethereum:"eth-mainnet",
  base:"base-mainnet",
  bsc:"bsc-mainnet",
  polygon:"polygon-mainnet",
  arbitrum:"arbitrum-mainnet",
  optimism:"optimism-mainnet",
  avalanche:"avalanche-mainnet",
  gnosis:"gnosis-mainnet",
  robinhood:"robinhood-mainnet",
  linea:"linea-mainnet",
  scroll:"scroll-mainnet",
  zksync:"zksync-mainnet",
  mantle:"mantle-mainnet"
};

async function detectEvmChain(ca){
  if(!EVM_ADDRESS.test(String(ca||"").trim())) return null;

  const address=String(ca).trim().toLowerCase();

  // First use public market data when available. This is only for resolving
  // the chain; the investigation itself still uses the existing providers.
  try{
    const response=await fetch(
      `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(ca)}`,
      {headers:{Accept:"application/json"}}
    );
    if(response.ok){
      const body=await response.json();
      const pairs=Array.isArray(body?.pairs)?body.pairs:[];
      const matches=pairs
        .filter(p=>{
          const base=String(p?.baseToken?.address||"").toLowerCase();
          const quote=String(p?.quoteToken?.address||"").toLowerCase();
          return base===address||quote===address;
        })
        .map(p=>({
          chain:DEX_TO_GOLDRUSH_CHAIN[String(p?.chainId||"").toLowerCase()]||null,
          liquidity:Number(p?.liquidity?.usd||0)
        }))
        .filter(p=>p.chain);

      if(matches.length){
        matches.sort((a,b)=>b.liquidity-a.liquidity);
        return matches[0].chain;
      }
    }
  }catch{}

  // If the token has no indexed DEX pair, resolve the chain from the same
  // GoldRush data source the investigation already uses. This fallback is
  // deliberately isolated here: explicit chain overrides and all existing
  // investigation/planner/verdict behavior remain unchanged.
  const apiKey=process.env.GOLDRUSH_API_KEY;
  if(!apiKey) return null;

  const chains=[
    "eth-mainnet",
    "base-mainnet",
    "bsc-mainnet",
    "matic-mainnet",
    "arbitrum-mainnet",
    "optimism-mainnet",
    "avalanche-mainnet",
    "gnosis-mainnet",
    "robinhood-mainnet",
    "linea-mainnet",
    "scroll-mainnet",
    "zksync-mainnet",
    "mantle-mainnet",
    "unichain-mainnet",
    "berachain-mainnet",
    "ink-mainnet",
    "monad-mainnet",
    "hyperevm-mainnet",
    "world-mainnet",
    "apechain-mainnet",
    "blast-mainnet",
    "celo-mainnet",
    "fantom-mainnet",
    "moonbeam-mainnet",
    "sonic-mainnet",
    "sei-mainnet",
    "taiko-mainnet",
    "zksync-mainnet"
  ];

  const probe=async chain=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(
        `https://api.covalenthq.com/v1/${chain}/tokens/${encodeURIComponent(ca)}/token_holders_v2/?page-number=0&page-size=1`,
        {
          headers:{
            Accept:"application/json",
            Authorization:`Bearer ${apiKey}`
          },
          signal:controller.signal
        }
      );

      if(!response.ok) return null;

      const body=await response.json().catch(()=>null);
      const data=body?.data||body;
      const items=Array.isArray(data?.items)?data.items:[];

      // A successful token-holder response is enough to establish the chain.
      // Empty holder data is retained as a valid chain result because a
      // contract can legitimately have no indexed holders yet.
      if(items.length||data?.pagination) return chain;
      return null;
    }catch{
      return null;
    }finally{
      clearTimeout(timer);
    }
  };

  // Probe sequentially so a single token lookup does not fan out into a
  // burst of concurrent provider requests.
  for(const chain of chains){
    const found=await probe(chain);
    if(found) return found;
  }

  return null;
}

function buildCase(raw,chainOverride){
  let c;
  if(isFixtureKey(raw)){
    c=cases[String(raw).toUpperCase()];
  }else{
    const input=normalizeInput(raw,chainOverride);
    const goldrushProvider=new GoldRushProvider();
    const goldrushTools=createGoldRushTools(input,goldrushProvider);
    const cmcProvider=new CoinMarketCapProvider();
    const cmcTools=createCoinMarketCapTools(input,cmcProvider);
    const rpcProvider=new RpcProvider();
    const rpcTools=createRpcTools(input,rpcProvider);
    const tools={
      ...goldrushTools,
      ...(rpcProvider.enabled(input.chain)?{
        inspectToken:async()=>{
          const [gold,rpc]=await Promise.all([goldrushTools.inspectToken(),rpcTools.inspectToken()]);
          return {tool:"inspect_token",facts:{...(gold?.facts||{}),...(rpc?.facts||{}),deployer:rpc?.facts?.deployer||gold?.facts?.deployer||null,rpcVerified:rpc?.facts?.rpcVerified??false}};
        },
        inspectActorBehavior:async(state)=>{
          const base=input.chain==="solana-mainnet"?cmcTools.inspectActorBehavior(state):goldrushTools.inspectActorBehavior(state);
          const [primary,rpc]=await Promise.all([base,rpcTools.inspectActorBehavior(state)]);
          const a=primary?.facts||{},r=rpc?.facts||{};
          return {tool:"inspect_actor_behavior",facts:{...a,...r,supported:Boolean(a.supported!==false||r.supported),deployer:r.deployer||a.deployer||null,deployerExit:Boolean(a.deployerExit||r.deployerPossibleSaleCount>0),deployerExitDetails:a.deployerExitDetails||(r.deployerPossibleSaleCount>0?`${r.deployerPossibleSaleCount} possible deployer sale transaction(s) were observed in RPC history; these require transaction-level interpretation before being treated as proof of an exit.`:null),deployerLinkedExit:Boolean(a.deployerLinkedExit),earlyHolderDump:Boolean(a.earlyHolderDump),cautions:[...(a.cautions||[]),...(r.deployerTransferCount?[`RPC observed ${r.deployerTransferCount} token transfer transaction(s) from the deployer. Transfers can represent airdrops, allocations, or wallet distribution and are not proof of a rug by themselves.`]:[])],rpcDeployerTransfers:r.deployerTransfers||[],rpcPossibleSales:r.possibleSales||[]}};
        }
      }:{}),
      ...(input.chain==="solana-mainnet"?{inspectHolders:cmcTools.inspectHolders,inspectActorBehavior:cmcTools.inspectActorBehavior}:{inspectActorBehavior:goldrushTools.inspectActorBehavior})
    };
    c={token:{ca:input.ca,symbol:null,name:null,deployer:null,totalSupply:null,chain:input.chain},tools};
  }
  return c;
}

function json(res,status,data){
  const body=JSON.stringify(data);
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(body);
}
function sendFile(res,file,type){
  res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});
  fs.createReadStream(path.join(publicDir,file)).pipe(res);
}
function safeEvent(message){
  const text=String(message||"");
  if(/^REASONING/.test(text)) return null;
  return text;
}
function publish(job,type,payload={}){
  const data=JSON.stringify({type,...payload});
  job.events.push({data});
  for(const client of job.clients){try{client.write(`data: ${data}\n\n`)}catch{}}
}
async function runJob(job,ca,chain){
  try{
    publish(job,"event",{message:"INVESTIGATION STARTED"});
    const effectiveChain=chain||await detectEvmChain(ca);
    const caseData=buildCase(ca,effectiveChain);
    job.ca=caseData.token.ca;
    const agent=new AutopsyAgent(caseData,{onEvent:event=>{
      const safe=safeEvent(event);
      if(safe) publish(job,"event",{message:safe});
    }});
    const result=await agent.run();
    job.result=result;
    job.status="complete";
    publish(job,"complete",{result});
  }catch(error){
    job.status="error";
    job.error=String(error?.message||error);
    publish(job,"error",{message:job.error});
  }
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
  if(req.method==="GET"&&url.pathname==="/") return sendFile(res,"index.html","text/html; charset=utf-8");
  if(req.method==="GET"&&url.pathname==="/trace") return sendFile(res,"trace.html","text/html; charset=utf-8");
  if(req.method==="GET"&&url.pathname==="/verdict") return sendFile(res,"verdict.html","text/html; charset=utf-8");

  if(req.method==="POST"&&url.pathname==="/api/autopsy"){
    let body="";
    req.on("data",chunk=>{body+=chunk;if(body.length>10000)req.destroy()});
    req.on("end",()=>{
      try{
        const input=JSON.parse(body||"{}");
        const ca=String(input.ca||input.token||input.address||"").trim();
        if(!ca) return json(res,400,{error:"Missing token contract address."});
        const job={id:randomUUID(),ca,status:"running",events:[],clients:new Set(),result:null,error:null};
        jobs.set(job.id,job);
        json(res,202,{jobId:job.id});
        void runJob(job,ca,input.chain||null);
      }catch(error){
        json(res,400,{error:String(error.message||error)});
      }
    });
    return;
  }

  const eventMatch=url.pathname.match(/^\/api\/autopsy\/([^/]+)\/events$/);
  if(req.method==="GET"&&eventMatch){
    const job=jobs.get(eventMatch[1]);
    if(!job) return json(res,404,{error:"Case not found."});
    res.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.write("retry: 1500\n\n");
    for(const e of job.events) res.write(`data: ${e.data}\n\n`);
    job.clients.add(res);
    const heartbeat=setInterval(()=>{try{res.write(": heartbeat\n\n")}catch{}},15000);
    req.on("close",()=>{clearInterval(heartbeat);job.clients.delete(res)});
    return;
  }

  const resultMatch=url.pathname.match(/^\/api\/autopsy\/([^/]+)$/);
  if(req.method==="GET"&&resultMatch){
    const job=jobs.get(resultMatch[1]);
    if(!job) return json(res,404,{error:"Case not found."});
    return json(res,200,{status:job.status,ca:job.ca||job.result?.input||job.input,error:job.error,result:job.result});
  }

  if(req.method==="GET"&&url.pathname==="/health") return json(res,200,{ok:true,service:"on-chain-autopsy",jobs:jobs.size});
  res.writeHead(404,{"Content-Type":"text/plain"});res.end("Not found");
});
server.listen(PORT,HOST,()=>console.log(`On-Chain Autopsy running at http://${HOST}:${PORT}`));

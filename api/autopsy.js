import {AutopsyAgent} from "../src/agent.js";
import {cases} from "../src/data/cases.js";
import {normalizeInput,isFixtureKey} from "../src/input.js";
import {createGoldRushTools,GoldRushProvider} from "../src/providers/goldrush.js";
import {createCoinMarketCapTools,CoinMarketCapProvider} from "../src/providers/coinmarketcap.js";
import {createRpcTools,RpcProvider} from "../src/providers/rpc.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const EVM_ADDRESS=/^0x[a-fA-F0-9]{40}$/;
const DEX_TO_GOLDRUSH_CHAIN={
  ethereum:"eth-mainnet",base:"base-mainnet",bsc:"bsc-mainnet",polygon:"polygon-mainnet",
  arbitrum:"arbitrum-mainnet",optimism:"optimism-mainnet",avalanche:"avalanche-mainnet",
  gnosis:"gnosis-mainnet",robinhood:"robinhood-mainnet",linea:"linea-mainnet",
  scroll:"scroll-mainnet",zksync:"zksync-mainnet",mantle:"mantle-mainnet"
};

async function detectEvmChain(ca){
  console.log("[AUTOPSY DIAG] detectEvmChain:start", { isEvm: EVM_ADDRESS.test(String(ca||"").trim()) });
  if(!EVM_ADDRESS.test(String(ca||"").trim())) { console.log("[AUTOPSY DIAG] detectEvmChain:non-evm"); return null; }
  const address=String(ca).trim().toLowerCase();

  // Fast path: DexScreener already knows the chain for tokens with a market/pair.
  try{
    console.log("[AUTOPSY DIAG] dexscreen:request");
    const response=await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(ca)}`,{headers:{Accept:"application/json"}});
    console.log("[AUTOPSY DIAG] dexscreen:response", response.status);
    if(response.ok){
      const body=await response.json();
      const pairs=Array.isArray(body?.pairs)?body.pairs:[];
      const matches=pairs.filter(p=>{
        const base=String(p?.baseToken?.address||"").toLowerCase();
        const quote=String(p?.quoteToken?.address||"").toLowerCase();
        return base===address||quote===address;
      }).map(p=>({chain:DEX_TO_GOLDRUSH_CHAIN[String(p?.chainId||"").toLowerCase()]||null,liquidity:Number(p?.liquidity?.usd||0)})).filter(p=>p.chain);
      if(matches.length){matches.sort((a,b)=>b.liquidity-a.liquidity);return matches[0].chain;}
    }
  }catch(error){ console.log("[AUTOPSY DIAG] dexscreen:error", String(error?.message||error)); }

  // Bounded fallback. The old implementation probed every chain one-by-one,
  // allowing up to ~200s before the actual investigation even started.
  // Probe a small batch in parallel with a short timeout instead.
  const apiKey=process.env.GOLDRUSH_API_KEY;
  console.log("[AUTOPSY DIAG] chain fallback:api-key", Boolean(apiKey));
  if(!apiKey) { console.log("[AUTOPSY DIAG] chain fallback:skipped-no-key"); return null; }
  const chains=["eth-mainnet","base-mainnet","bsc-mainnet","matic-mainnet","arbitrum-mainnet","optimism-mainnet","avalanche-mainnet","gnosis-mainnet","robinhood-mainnet","linea-mainnet","scroll-mainnet","zksync-mainnet","mantle-mainnet","unichain-mainnet","berachain-mainnet","ink-mainnet","monad-mainnet","hyperevm-mainnet","world-mainnet","apechain-mainnet","blast-mainnet","celo-mainnet","fantom-mainnet","moonbeam-mainnet","sonic-mainnet","sei-mainnet","taiko-mainnet"];
  const timeoutMs=2500;
  const batchSize=5;
  for(let i=0;i<chains.length;i+=batchSize){
    const batch=chains.slice(i,i+batchSize);
    console.log("[AUTOPSY DIAG] chain fallback:batch", batch);
    const found=await Promise.all(batch.map(async chain=>{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        console.log("[AUTOPSY DIAG] covalent:request", chain);
        const response=await fetch(`https://api.covalenthq.com/v1/${chain}/tokens/${encodeURIComponent(ca)}/token_holders_v2/?page-number=0&page-size=1`,{headers:{Accept:"application/json",Authorization:`Bearer ${apiKey}`},signal:controller.signal});
        console.log("[AUTOPSY DIAG] covalent:response", chain, response.status);
        if(!response.ok) return null;
        const body=await response.json().catch(()=>null);
        const data=body?.data||body;
        const items=Array.isArray(data?.items)?data.items:[];
        return (items.length||data?.pagination)?chain:null;
      }catch{return null;} finally{clearTimeout(timer);}
    }));
    const match=found.find(Boolean);
    console.log("[AUTOPSY DIAG] chain fallback:batch-result", match||null);
    if(match) return match;
  }
  console.log("[AUTOPSY DIAG] detectEvmChain:none");
  return null;
}

function buildCase(raw,chainOverride){
  console.log("[AUTOPSY DIAG] buildCase:start", { fixture:isFixtureKey(raw), chainOverride:chainOverride||null });
  if(isFixtureKey(raw)) { console.log("[AUTOPSY DIAG] buildCase:fixture"); return cases[String(raw).toUpperCase()]; }
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
      inspectToken:async()=>{const [gold,rpc]=await Promise.all([goldrushTools.inspectToken(),rpcTools.inspectToken()]);return {tool:"inspect_token",facts:{...(gold?.facts||{}),...(rpc?.facts||{}),deployer:rpc?.facts?.deployer||gold?.facts?.deployer||null,rpcVerified:rpc?.facts?.rpcVerified??false}};},
      inspectActorBehavior:async(state)=>{const base=input.chain==="solana-mainnet"?cmcTools.inspectActorBehavior(state):goldrushTools.inspectActorBehavior(state);const [primary,rpc]=await Promise.all([base,rpcTools.inspectActorBehavior(state)]);const a=primary?.facts||{},r=rpc?.facts||{};return {tool:"inspect_actor_behavior",facts:{...a,...r,supported:Boolean(a.supported!==false||r.supported),deployer:r.deployer||a.deployer||null,deployerExit:Boolean(a.deployerExit||r.deployerPossibleSaleCount>0),deployerExitDetails:a.deployerExitDetails||(r.deployerPossibleSaleCount>0?`${r.deployerPossibleSaleCount} possible deployer sale transaction(s) were observed in RPC history; these require transaction-level interpretation before being treated as proof of an exit.`:null),deployerLinkedExit:Boolean(a.deployerLinkedExit),earlyHolderDump:Boolean(a.earlyHolderDump),cautions:[...(a.cautions||[]),...(r.deployerTransferCount?[`RPC observed ${r.deployerTransferCount} token transfer transaction(s) from the deployer. Transfers can represent airdrops, allocations, or wallet distribution and are not proof of a rug by themselves.`]:[])],rpcDeployerTransfers:r.deployerTransfers||[],rpcPossibleSales:r.possibleSales||[]}};}
    }:{}),
    ...(input.chain==="solana-mainnet"?{inspectHolders:cmcTools.inspectHolders,inspectActorBehavior:cmcTools.inspectActorBehavior}:{inspectActorBehavior:goldrushTools.inspectActorBehavior})
  };
  console.log("[AUTOPSY DIAG] buildCase:ready", { chain:input.chain });
  return {token:{ca:input.ca,symbol:null,name:null,deployer:null,totalSupply:null,chain:input.chain},tools};
}

function safeEvent(message){const text=String(message||"");return /^REASONING/.test(text)?null:text;}
function send(res,payload){res.write(`data: ${JSON.stringify(payload)}\n\n`);}

export default async function handler(req,res){
  console.log("[AUTOPSY DIAG] handler:entered", req.method);
  if(req.method!=="POST"){res.statusCode=405;res.setHeader("Allow","POST");return res.end("Method Not Allowed");}
  res.statusCode=200;
  res.setHeader("Content-Type","text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control","no-cache, no-transform");
  res.setHeader("Connection","keep-alive");
  res.setHeader("X-Accel-Buffering","no");
  res.flushHeaders?.();
  console.log("[AUTOPSY DIAG] handler:stream-open");
  send(res,{type:"event",message:"INVESTIGATION STARTED"});
  console.log("[AUTOPSY DIAG] handler:initial-event-sent");
  const heartbeat=setInterval(()=>{try{res.write(": keep-alive\n\n");}catch{}},10000);
  try{
    const body=typeof req.body==="object"&&req.body!==null?req.body:await new Promise((resolve,reject)=>{let raw="";req.on("data",c=>{raw+=c;if(raw.length>10000)reject(new Error("Request too large."));});req.on("end",()=>{try{resolve(JSON.parse(raw||"{}"));}catch(e){reject(e);}});req.on("error",reject);});
    console.log("[AUTOPSY DIAG] body:received", { keys:Object.keys(body||{}) });
    const ca=String(body?.ca||body?.token||body?.address||"").trim();
    console.log("[AUTOPSY DIAG] body:ca-present", Boolean(ca));
    if(!ca) throw new Error("Missing token contract address.");
    console.log("[AUTOPSY DIAG] chain:resolving", body?.chain||null);
    const effectiveChain=body?.chain||await detectEvmChain(ca);
    console.log("[AUTOPSY DIAG] chain:resolved", effectiveChain||null);
    const caseData=buildCase(ca,effectiveChain);
    console.log("[AUTOPSY DIAG] agent:creating");
    const agent=new AutopsyAgent(caseData,{onEvent:event=>{const safe=safeEvent(event);if(safe)send(res,{type:"event",message:safe});}});
    console.log("[AUTOPSY DIAG] agent:run-start");
    const result=await agent.run();
    console.log("[AUTOPSY DIAG] agent:run-complete");
    send(res,{type:"complete",result});
  }catch(error){
    console.log("[AUTOPSY DIAG] handler:error", String(error?.message||error));
    send(res,{type:"error",message:String(error?.message||error)});
  }
  clearInterval(heartbeat);
  console.log("[AUTOPSY DIAG] handler:end");
  res.end();
}

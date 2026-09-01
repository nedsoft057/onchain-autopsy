function hexToBigInt(value){
  try{return BigInt(value||"0x0")}catch{return 0n}
}

async function jsonRpc(url,method,params=[],timeoutMs=12000){
  if(!url) throw new Error("RPC endpoint is not configured.");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:controller.signal});
    const body=await res.json();
    if(!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    if(body?.error) throw new Error(body.error.message||`RPC ${method} failed`);
    return body?.result;
  }finally{clearTimeout(timer)}
}

function decodeUint256(hex){return hexToBigInt(hex);}

function accountKeyValue(key){
  if(typeof key==="string")return {pubkey:key,signer:false};
  return {pubkey:key?.pubkey||null,signer:Boolean(key?.signer)};
}

function tokenBalanceMap(balances=[],mint){
  const out=new Map();
  for(const row of balances){
    if(!row?.mint||row.mint!==mint)continue;
    const owner=row.owner||null;
    if(!owner)continue;
    out.set(owner,{raw:row.uiTokenAmount?.amount||"0",ui:Number(row.uiTokenAmount?.uiAmount||0),decimals:row.uiTokenAmount?.decimals??0});
  }
  return out;
}

function tokenDeltaRows(tx,mint){
  const meta=tx?.meta;
  if(!meta)return [];
  const pre=tokenBalanceMap(meta.preTokenBalances,mint);
  const post=tokenBalanceMap(meta.postTokenBalances,mint);
  const owners=new Set([...pre.keys(),...post.keys()]);
  const rows=[];
  for(const owner of owners){
    const a=pre.get(owner)||{raw:"0",ui:0,decimals:post.get(owner)?.decimals||0};
    const b=post.get(owner)||{raw:"0",ui:0,decimals:a.decimals};
    const delta=BigInt(b.raw)-BigInt(a.raw);
    if(delta!==0n)rows.push({wallet:owner,deltaRaw:delta.toString(),delta:Number(delta)/10**(b.decimals??0),decimals:b.decimals??0});
  }
  return rows;
}

export class RpcProvider{
  constructor({evmUrl=process.env.EVM_RPC_URL||process.env.RPC_URL||null,solanaUrl=process.env.SOLANA_RPC_URL||null,timeoutMs=Number(process.env.RPC_TIMEOUT_MS||12000)}={}){
    this.evmUrl=evmUrl; this.solanaUrl=solanaUrl; this.timeoutMs=timeoutMs;
  }
  enabled(chain){return chain==="solana-mainnet"?Boolean(this.solanaUrl):Boolean(this.evmUrl);}

  async evmToken(ca){
    const code=await jsonRpc(this.evmUrl,"eth_getCode",[ca,"latest"],this.timeoutMs);
    const supplyRaw=await jsonRpc(this.evmUrl,"eth_call",[{to:ca,data:"0x18160ddd"},"latest"],this.timeoutMs).catch(()=>null);
    return {chain:"evm",established:code&&code!=="0x",contractCodePresent:Boolean(code&&code!=="0x"),totalSupplyRaw:supplyRaw?decodeUint256(supplyRaw).toString():null};
  }

  async solanaToken(ca){
    const supply=await jsonRpc(this.solanaUrl,"getTokenSupply",[ca,{commitment:"confirmed"}],this.timeoutMs);
    const largest=await jsonRpc(this.solanaUrl,"getTokenLargestAccounts",[ca,{commitment:"confirmed"}],this.timeoutMs);
    const value=supply?.value||{};
    const accounts=Array.isArray(largest?.value)?largest.value:[];
    const total=Number(value.uiAmountString||value.uiAmount||0);
    const wallets=accounts.map(a=>({wallet:a.address,balanceRaw:a.amount,balance:Number(a.uiAmount||0),share:total>0?Number(a.uiAmount||0)/total:0}));
    return {chain:"solana-mainnet",established:Boolean(value.amount),totalSupplyRaw:value.amount||null,decimals:value.decimals??null,holderCoverage:"top_token_accounts",walletCount:wallets.length,concentratedWalletCount:wallets.filter(x=>x.share>=.03).length,concentratedShare:wallets.filter(x=>x.share>=.03).reduce((s,x)=>s+x.share,0),topHolderShare:wallets[0]?.share||0,top5Share:wallets.slice(0,5).reduce((s,x)=>s+x.share,0),wallets,sufficientForConcentration:true};
  }

  async solanaFirstActivity(ca){
    const signatures=await jsonRpc(this.solanaUrl,"getSignaturesForAddress",[ca,{limit:100}],this.timeoutMs);
    const list=Array.isArray(signatures)?signatures.filter(x=>x?.signature):[];
    if(!list.length)return {deployer:null,firstObservedTransaction:null,firstObservedAt:null};
    const ordered=[...list].sort((a,b)=>(a.blockTime||Number.MAX_SAFE_INTEGER)-(b.blockTime||Number.MAX_SAFE_INTEGER));
    for(const sig of ordered.slice(0,10)){
      try{
        const tx=await jsonRpc(this.solanaUrl,"getTransaction",[sig.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:0}],this.timeoutMs);
        const keys=(tx?.transaction?.message?.accountKeys||[]).map(accountKeyValue);
        const signer=keys.find(k=>k.signer)?.pubkey||null;
        if(signer)return {deployer:signer,firstObservedTransaction:sig.signature,firstObservedAt:sig.blockTime?new Date(sig.blockTime*1000).toISOString():null};
      }catch{}
    }
    return {deployer:null,firstObservedTransaction:list[list.length-1]?.signature||null,firstObservedAt:null};
  }

  async solanaActorActivity(ca,deployer){
    if(!deployer)return {supported:false,reason:"Deployer address was not established by the available RPC history."};
    const signatures=await jsonRpc(this.solanaUrl,"getSignaturesForAddress",[deployer,{limit:100}],this.timeoutMs);
    const sigs=Array.isArray(signatures)?signatures.filter(x=>x?.signature).slice(0,100):[];
    const transfers=[];
    const sells=[];
    const deployerLower=deployer.toLowerCase();
    for(const sig of sigs){
      try{
        const tx=await jsonRpc(this.solanaUrl,"getTransaction",[sig.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:0}],this.timeoutMs);
        const deltas=tokenDeltaRows(tx,ca);
        const own=deltas.find(x=>x.wallet?.toLowerCase()===deployerLower);
        if(!own)continue;
        const otherPositive=deltas.filter(x=>x.wallet?.toLowerCase()!==deployerLower&&x.delta>0);
        const otherNegative=deltas.filter(x=>x.wallet?.toLowerCase()!==deployerLower&&x.delta<0);
        if(own.delta<0&&otherPositive.length){
          transfers.push({txHash:sig.signature,time:sig.blockTime?new Date(sig.blockTime*1000).toISOString():null,amount:Math.abs(own.delta),recipients:otherPositive.map(x=>({wallet:x.wallet,amount:x.delta})),type:"deployer_token_transfer"});
        }
        if(own.delta<0&&otherNegative.length===0){
          const nativeBefore=tx?.meta?.preBalances?.[0];
          const nativeAfter=tx?.meta?.postBalances?.[0];
          if(Number.isFinite(nativeBefore)&&Number.isFinite(nativeAfter)&&nativeAfter>nativeBefore){
            sells.push({txHash:sig.signature,time:sig.blockTime?new Date(sig.blockTime*1000).toISOString():null,amount:Math.abs(own.delta),nativeChange:(nativeAfter-nativeBefore)/1e9,type:"possible_deployer_sale"});
          }
        }
      }catch{}
    }
    const materialTransferShare=transfers.reduce((s,x)=>s+x.amount,0);
    return {supported:true,deployer,scannedTransactions:sigs.length,deployerTransfers:transfers.slice(0,20),possibleSales:sells.slice(0,20),deployerTransferCount:transfers.length,deployerPossibleSaleCount:sells.length,materialTransferShare};
  }

  async inspectToken(chain,ca){
    if(!this.enabled(chain)) return {tool:"inspect_token",facts:{rpcSupported:false,chain,ca}};
    try{
      if(chain==="solana-mainnet"){
        const token=await this.solanaToken(ca);
        const activity=await this.solanaFirstActivity(ca).catch(()=>({}));
        return {tool:"inspect_token",facts:{provider:"rpc",rpcVerified:true,...token,...activity}};
      }
      return {tool:"inspect_token",facts:{provider:"rpc",rpcVerified:true,...await this.evmToken(ca)}};
    }catch(error){return {tool:"inspect_token",facts:{provider:"rpc",rpcVerified:false,chain,ca,rpcError:error.message}}}
  }

  async inspectHolders(chain,ca){
    if(chain!=="solana-mainnet"||!this.solanaUrl) return {tool:"inspect_holders",facts:{provider:"rpc",supported:false,reason:"RPC holder fallback is configured only for Solana token accounts."}};
    try{return {tool:"inspect_holders",facts:{provider:"rpc",supported:true,...await this.solanaToken(ca)}}}
    catch(error){return {tool:"inspect_holders",facts:{provider:"rpc",supported:false,reason:error.message}}}
  }

  async inspectActorBehavior(chain,ca,tokenFacts={}){
    if(chain!=="solana-mainnet"||!this.solanaUrl)return {tool:"inspect_actor_behavior",facts:{provider:"rpc",supported:false,reason:"RPC actor tracing is currently enabled for Solana only."}};
    try{
      const activity=await this.solanaActorActivity(ca,tokenFacts.deployer||null);
      return {tool:"inspect_actor_behavior",facts:{provider:"rpc",...activity}};
    }catch(error){return {tool:"inspect_actor_behavior",facts:{provider:"rpc",supported:false,reason:error.message}}}
  }
}

export function createRpcTools(input,provider=new RpcProvider()){
  return {
    inspectToken:()=>provider.inspectToken(input.chain,input.ca),
    inspectHolders:()=>provider.inspectHolders(input.chain,input.ca),
    inspectActorBehavior:(state)=>provider.inspectActorBehavior(input.chain,input.ca,state.observations.token||{}),
  };
}

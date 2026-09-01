const DEFAULT_BASE='https://api.covalenthq.com/v1';
const DEX_BASE='https://api.dexscreener.com';

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

async function requestJson(url,{apiKey,timeoutMs=20000,retries=2}={}){
  let lastError;
  for(let attempt=0;attempt<=retries;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const res=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${apiKey}`},signal:controller.signal});
      const text=await res.text();
      let body=null;
      try{body=text?JSON.parse(text):null}catch{body=null}
      if(!res.ok){
        const messages={
          400:'GoldRush rejected the request. Check the chain, address, and endpoint parameters.',
          401:'GoldRush authentication failed. Check GOLDRUSH_API_KEY.',
          402:'GoldRush returned 402 Payment Required. Check API credits, plan, or spending limits.',
          404:'GoldRush could not find the requested resource on this chain.',
          429:'GoldRush rate limit reached. The provider will retry automatically when possible.',
        };
        const message=body?.error_message||body?.error||messages[res.status]||`GoldRush HTTP ${res.status}`;
        const err=new Error(message); err.status=res.status; err.provider='goldrush'; err.body=body; throw err;
      }
      if(!body) throw Object.assign(new Error(`GoldRush returned an empty/non-JSON response (${res.status})`),{status:res.status,provider:'goldrush'});

      return body;
    }catch(error){
      lastError=error;
      const retryable=error?.name==='AbortError'||error?.status===429||error?.status>=500;
      if(!retryable||attempt===retries) break;
      await sleep(350*(attempt+1));
    }finally{clearTimeout(timer)}
  }
  throw lastError||new Error('GoldRush request failed');
}

async function dexJson(url,{timeoutMs=12000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
    if(!res.ok) throw new Error(`DEX market lookup failed (${res.status})`);
    return await res.json();
  }finally{clearTimeout(timer)}
}

function unwrap(body){return body?.data??body}
function lower(x){return typeof x==='string'?x.toLowerCase():x}
function num(x){const n=Number(x);return Number.isFinite(n)?n:null}

function chainToDex(chain){
  const map={
    'eth-mainnet':'ethereum','base-mainnet':'base','bsc-mainnet':'bsc','polygon-mainnet':'polygon','matic-mainnet':'polygon','arbitrum-mainnet':'arbitrum','optimism-mainnet':'optimism','solana-mainnet':'solana','avalanche-mainnet':'avalanche','gnosis-mainnet':'gnosis','robinhood-mainnet':'robinhood'
  };
  return map[chain]||chain.replace('-mainnet','');
}

export class GoldRushProvider{
  constructor({apiKey=process.env.GOLDRUSH_API_KEY,baseUrl=process.env.GOLDRUSH_BASE_URL||DEFAULT_BASE,timeoutMs=Number(process.env.GOLDRUSH_TIMEOUT_MS||20000),dexEnabled=process.env.DEXSCREENER_ENABLED!=='false'}={}){
    // GoldRush's current Foundational API documentation still uses
    // api.covalenthq.com/v1, despite the GoldRush branding.

    this.apiKey=apiKey; this.baseUrl=baseUrl.replace(/\/$/,''); this.timeoutMs=timeoutMs; this.dexEnabled=dexEnabled;
    if(!this.apiKey) throw new Error('GOLDRUSH_API_KEY is not configured.');
  }

  url(path,params={}){
    const qs=new URLSearchParams(params);
    return `${this.baseUrl}/${path.replace(/^\//,'')}${qs.toString()?`?${qs}`:''}`;
  }

  async holders(chain,ca){
    if(chain==='solana-mainnet') return {items:[],pagination:{has_more:false},unsupported:true,reason:'GoldRush Foundational token-holder snapshots are not currently exposed for Solana in this adapter.'};
    const body=unwrap(await requestJson(this.url(`${chain}/tokens/${ca}/token_holders_v2/`,{'page-number':0,'page-size':1000}),{apiKey:this.apiKey,timeoutMs:this.timeoutMs}));
    return body||{};
  }

  async earliestTransactions(chain,address){
    const body=unwrap(await requestJson(this.url(`${chain}/bulk/transactions/${address}/`,{'no-logs':false}),{apiKey:this.apiKey,timeoutMs:this.timeoutMs}));
    return body||{};
  }

  async logs(chain,address,params={}){
    const body=unwrap(await requestJson(this.url(`${chain}/events/address/${address}/`,{'page-size':100,'page-number':0,...params}),{apiKey:this.apiKey,timeoutMs:this.timeoutMs}));
    return body||{};
  }

  async transactions(chain,address,params={}){
    const body=unwrap(await requestJson(this.url(`${chain}/address/${address}/transactions_v3/`,params),{apiKey:this.apiKey,timeoutMs:this.timeoutMs}));
    return body||{};
  }

  async tokenMarket(chain,ca){
    if(!this.dexEnabled) return {pairs:[],available:false};
    const dexChain=chainToDex(chain);
    // DexScreener is secondary market context, never the source of truth.
    // If a chain is not available there, continue with GoldRush data.
    try{
      const body=await dexJson(`${DEX_BASE}/token-pairs/v1/${dexChain}/${ca}`);
      return {pairs:Array.isArray(body)?body:[],available:true};
    }catch(error){
      return {pairs:[],available:false,error:String(error?.message||error)};
    }
  }

  async inspectToken(chain,ca){
    if(chain==='solana-mainnet'){
      const market=await this.tokenMarket(chain,ca);
      const pair=market.pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0]||null;
      return {tool:'inspect_token',facts:{ca,chain,symbol:pair?.baseToken?.address?.toLowerCase()===ca.toLowerCase()?pair.baseToken.symbol:pair?.quoteToken?.symbol||null,name:pair?.baseToken?.address?.toLowerCase()===ca.toLowerCase()?pair.baseToken.name:pair?.quoteToken?.name||null,decimals:null,totalSupply:null,deployer:null,firstObservedTransaction:null,established:Boolean(pair?.pairAddress),marketPair:pair?.pairAddress||null}};
    }
    let holders={items:[]};
    let holderError=null;
    try{
      holders=await this.holders(chain,ca);
    }catch(error){
      holderError=error;
    }
    const items=holders.items||[];
    const first=items[0]||{};
    let deployer=null;
    let earliest=null;
    try{
      const tx=await this.earliestTransactions(chain,ca);
      earliest=(tx.items||[])[0]||null;
      if(earliest?.from_address) deployer=earliest.from_address;
    }catch{}
    return {
      tool:'inspect_token',
      facts:{
        ca,
        chain,
        symbol:first.contract_ticker_symbol||null,
        name:first.contract_name||first.contract_display_name||null,
        decimals:first.contract_decimals??null,
        totalSupply:first.total_supply||null,
        deployer,
        firstObservedTransaction:earliest?.tx_hash||null,
        established:Boolean(first.contract_address||earliest?.tx_hash),
        providerStatus:holderError?{status:holderError.status||null,message:holderError.message}:null
      }
    };
  }

  async inspectHolders(chain,ca){
    const body=await this.holders(chain,ca);
    if(body.unsupported) return {tool:'inspect_holders',facts:{walletCount:null,concentratedWalletCount:null,concentratedShare:null,wallets:[],supported:false,reason:body.reason}};
    const items=body.items||[];
    const supplyRaw=items.find(x=>x.total_supply)?.total_supply||null;
    const decimals=items.find(x=>x.contract_decimals!=null)?.contract_decimals||0;
    const supply=Number(supplyRaw)/10**decimals;
    const holders=items.map(x=>({wallet:x.address,balanceRaw:x.balance,balance:Number(x.balance)/10**decimals,share:supply>0?Number(x.balance)/Number(supplyRaw):0})).filter(x=>x.wallet);
    const concentrated=holders.filter(x=>x.share>=.03).sort((a,b)=>b.share-a.share);
    return {tool:'inspect_holders',facts:{walletCount:holders.length,concentratedWalletCount:concentrated.length,concentratedShare:concentrated.reduce((s,x)=>s+x.share,0),wallets:concentrated,totalSupply:supplyRaw,decimals,updatedAt:body.updated_at||null,hasMore:body.pagination?.has_more===true}};
  }

  async inspectWalletCluster(chain,holdersFacts){
    const wallets=holdersFacts.wallets||[];
    const results=[];
    for(const holder of wallets.slice(0,20)){
      try{
        const tx=await this.earliestTransactions(chain,holder.wallet);
        const first=(tx.items||[])[0];
        results.push({wallet:holder.wallet,share:holder.share,fundedBy:first?.from_address||null,firstTx:first?.tx_hash||null});
      }catch{results.push({wallet:holder.wallet,share:holder.share,fundedBy:null,firstTx:null})}
    }
    const map=new Map();
    for(const row of results){
      if(!row.fundedBy) continue;
      const key=lower(row.fundedBy);
      if(!map.has(key)) map.set(key,{funder:row.fundedBy,wallets:[],share:0});
      const group=map.get(key); group.wallets.push(row.wallet); group.share+=row.share;
    }
    const clusters=[...map.values()].sort((a,b)=>b.share-a.share);
    const strongest=clusters[0];
    return {tool:'inspect_wallet_cluster',facts:{clusters,checkedWallets:results.length,source:'GoldRush earliest transaction data',strongCluster:Boolean(strongest&&strongest.wallets.length>=4&&strongest.share>=.30)}};
  }

  async inspectLiquidity(chain,ca){
    const market=await this.tokenMarket(chain,ca);
    const pairs=market.pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
    const primary=pairs[0]||null;
    let poolLogs=[];
    if(primary?.pairAddress){
      try{poolLogs=(await this.logs(chain,primary.pairAddress)).items||[]}catch{}
    }
    const burnEvents=poolLogs.filter(x=>/burn|remove liquidity/i.test(`${x.decoded?.name||''} ${x.decoded?.signature||''}`));
    const mintEvents=poolLogs.filter(x=>/mint|add liquidity/i.test(`${x.decoded?.name||''} ${x.decoded?.signature||''}`));
    return {tool:'inspect_liquidity',facts:{
      pair:primary?.pairAddress||null,dex:primary?.dexId||null,
      initialLiquidityUsd:primary?.liquidity?.usd??null,currentLiquidityUsd:primary?.liquidity?.usd??null,
      pairCreatedAt:primary?.pairCreatedAt?new Date(primary.pairCreatedAt).toISOString():null,
      marketCap:primary?.marketCap??null,priceUsd:primary?.priceUsd??null,
      pairs:pairs.slice(0,10).map(p=>({pairAddress:p.pairAddress,dexId:p.dexId,liquidityUsd:p.liquidity?.usd||0,createdAt:p.pairCreatedAt})),
      mintEventCount:mintEvents.length,burnEventCount:burnEvents.length,
      burnEvents:burnEvents.slice(0,20).map(x=>({txHash:x.tx_hash,time:x.block_signed_at,decoded:x.decoded||null})),
      removalRatio:null,
      note:'Current DEX liquidity is observable here. A historical removal ratio is only emitted when the provider returns sufficient pool-event data; it is never fabricated.'
    }};
  }

  async inspectActorBehavior(chain, holdersFacts, tokenFacts = {}) {
    const holders = holdersFacts?.wallets || [];
    const deployer = String(tokenFacts?.deployer || "").toLowerCase();
    const deployerFunded = holders.filter(h => String(h.fundingSource || "").toLowerCase() === deployer && deployer);
    const cautions = deployerFunded.length ? [`${deployerFunded.length} holder wallet(s) appear linked to the deployer funding source. This may represent an airdrop, allocation, or wallet distribution and is not proof of a rug by itself.`] : [];
    return {tool:"inspect_actor_behavior",facts:{supported:true,deployer,deployerExit:false,deployerLinkedExit:false,earlyHolderDump:false,deployerFundedWallets:deployerFunded,cautions,note:"GoldRush holder snapshots alone do not establish sell timing or direct transfer intent; no malicious conclusion is inferred without transaction-level evidence."}};
  }

  async inspectSellSequence(chain,holdersFacts){
    const wallets=(holdersFacts.wallets||[]).slice(0,12);
    const rows=[];
    for(const holder of wallets){
      try{
        const tx=await this.transactions(chain,holder.wallet,{'block-signed-at-asc':true});
        for(const item of (tx.items||[]).slice(0,50)) rows.push({wallet:holder.wallet,share:holder.share,time:item.block_signed_at,txHash:item.tx_hash,from:item.from_address,to:item.to_address,value:item.value,logs:item.log_events||[]});
      }catch{}
    }
    rows.sort((a,b)=>new Date(a.time||0)-new Date(b.time||0));
    const likelySwaps=rows.filter(r=>r.logs.some(l=>/swap|sell|trade/i.test(`${l.decoded?.name||''} ${l.decoded?.signature||''}`)));
    return {tool:'inspect_sell_sequence',facts:{count:likelySwaps.length,sequence:likelySwaps.slice(0,40),coordinated:false,coordinationStatus:'requires token-specific DEX event classification before asserting coordination'}};
  }
}

export function createGoldRushTools(input,provider=new GoldRushProvider()){
  const {ca,chain}=input;
  return {
    inspectToken:()=>provider.inspectToken(chain,ca),
    inspectLiquidity:()=>provider.inspectLiquidity(chain,ca),
    inspectHolders:()=>provider.inspectHolders(chain,ca),
    inspectWalletCluster:(state)=>provider.inspectWalletCluster(chain,state.observations.holders),
    inspectSellSequence:(state)=>provider.inspectSellSequence(chain,state.observations.holders),
    inspectActorBehavior:(state)=>provider.inspectActorBehavior(chain,state.observations.holders,state.observations.token),
  };
}

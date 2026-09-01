export function createTools(c){
  return {
    inspectToken(){
      return {tool:"inspect_token",facts:c.token};
    },
    inspectLiquidity(){
      const l=c.liquidity;
      return {tool:"inspect_liquidity",facts:{...l,removalRatio:l.initialEth?l.removedEth/l.initialEth:0}};
    },
    inspectHolders(){
      const concentrated=c.holders.filter(x=>x.share>=.03);
      return {tool:"inspect_holders",facts:{walletCount:c.holders.length,concentratedWalletCount:concentrated.length,concentratedShare:concentrated.reduce((s,x)=>s+x.share,0),wallets:concentrated}};
    },
    inspectWalletCluster(){
      const m=new Map();
      for(const h of c.holders){
        if(!m.has(h.fundedBy))m.set(h.fundedBy,[]);
        m.get(h.fundedBy).push(h);
      }
      return {tool:"inspect_wallet_cluster",facts:{clusters:[...m].map(([funder,wallets])=>({funder,wallets:wallets.map(x=>x.wallet),share:wallets.reduce((s,x)=>s+x.share,0)})).sort((a,b)=>b.share-a.share)}};
    },
    inspectSellSequence(){
      const sequence=[...c.sells].sort((a,b)=>a.sequence-b.sequence);
      const times=sequence.map(x=>Date.parse(x.time||x.timestamp||"")).filter(Number.isFinite).sort((a,b)=>a-b);
      const span=times.length>=2?times[times.length-1]-times[0]:null;
      const timingSupported=span!=null;
      const coordinated=sequence.length>=3 && (!timingSupported || span<=30*60*1000);
      return {tool:"inspect_sell_sequence",facts:{count:sequence.length,sequence,coordinated,coordinationStatus:timingSupported?`Seller activity spans ${Math.round(span/60000)} minutes.`:"Sequence lacks timestamps; coordination remains provisional."}};
    },
    inspectActorBehavior(){
      const deployer=String(c.token.deployer||"").toLowerCase();
      const deployerFunded=c.holders.filter(h=>String(h.fundedBy||"").toLowerCase()===deployer);
      const sellerWallets=new Set(c.sells.map(x=>String(x.wallet||"").toLowerCase()));
      const deployerExit=deployer && sellerWallets.has(deployer);
      const linked=deployerFunded.filter(h=>sellerWallets.has(String(h.wallet||"").toLowerCase()));
      const earlySellers=c.holders.filter(h=>sellerWallets.has(String(h.wallet||"").toLowerCase())&&h.share>=.03);
      return {tool:"inspect_actor_behavior",facts:{
        supported:true,deployer,deployerExit:Boolean(deployerExit),
        deployerLinkedExit:linked.length>0,
        earlyHolderDump:earlySellers.length>=2 && linked.length>=2,
        earlySellerCount:earlySellers.length,
        deployerFundedWallets:deployerFunded,
        cautions:deployerFunded.length?["Deployer transfers can represent airdrops or allocations and are not proof of a rug by themselves."]:[]
      }};
    }
  };
}

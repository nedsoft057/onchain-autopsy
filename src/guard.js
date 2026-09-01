const ALLOWED = new Set([
  "inspect_token",
  "inspect_liquidity",
  "inspect_holders",
  "inspect_wallet_cluster",
  "inspect_sell_sequence",
  "inspect_actor_behavior",
  "finish"
]);

const HOLDER_EXHAUSTED = ["unsupported","unsupported_by_provider","unsupported_by_current_foundational_endpoint","unsupported_by_current_endpoint","capability_exhausted"];

export class ActionGuard {
  validate(action, state) {
    if (!action || !ALLOWED.has(action)) return {ok:false,reason:"Action is not in the allowed investigation set."};
    const o=state.observations;
    if(action==="finish"){
      if(!o.token?.established&&!o.marketEstablished)return {ok:false,reason:"Cannot finish before the token has been established."};
      if(!o.initialLiquidity)return {ok:false,reason:"Cannot finish before initial liquidity has been investigated."};
      if(!o.holders)return {ok:false,reason:"Cannot finish before holder distribution has been investigated."};
      if(o.holders.supported===false&&!HOLDER_EXHAUSTED.includes(o.holders.reason))return {ok:false,reason:"Cannot finish while holder analysis is unavailable."};
      const relationshipClue=Boolean(
        (o.holders.concentratedShare||0)>=0.30 ||
        (o.holders.top5Share||0)>=0.50 ||
        o.actorAnalysis?.coordinationClue ||
        o.actorAnalysis?.coordinationSignal ||
        o.actorAnalysis?.sharedFundingSellerGroups?.some(g => Number(g.walletCount || g.wallets?.length || 0) >= 2) ||
        o.actorAnalysis?.deployerLinkedExit ||
        Number(o.actorAnalysis?.earlySellerCount||0)>=2
      );
      if(relationshipClue&&!o.walletCluster)return {ok:false,reason:"Cannot finish before meaningful wallet relationships have been investigated."};
      if(o.walletCluster && (o.walletCluster.strongCluster || o.actorAnalysis?.coordinationClue || o.actorAnalysis?.sharedFundingSellerGroups?.length || o.actorAnalysis?.deployerLinkedExit || o.actorAnalysis?.earlySellerCount>=2) && !o.sellSequence)return {ok:false,reason:"Cannot finish before relevant wallet selling behaviour has been investigated."};
      if(o.sellSequence?.coordinated&&!o.finalLiquidity)return {ok:false,reason:"Cannot finish before liquidity has been re-checked after coordinated selling."};
      const actorNeeded=Boolean(o.holders.sellerCount||o.holders.sharedFundingSources?.length||o.holders.deployerFundedWallets?.length);
      if(actorNeeded&&!o.actorAnalysis)return {ok:false,reason:"Cannot finish before seller and funding behaviour has been classified."};
      return {ok:true,reason:"Required investigation evidence has been collected."};
    }
    if(action==="inspect_token"&&o.token)return {ok:false,reason:"Token has already been inspected."};
    if(action==="inspect_holders"&&o.holders)return {ok:false,reason:"Holder distribution has already been inspected."};
    if(action==="inspect_wallet_cluster"){
      if(!o.holders)return {ok:false,reason:"Wallet relationships cannot be investigated before holder distribution."};
      const relationshipClue=Boolean(
        (o.holders.concentratedShare||0)>=0.30 ||
        (o.holders.top5Share||0)>=0.50 ||
        o.actorAnalysis?.coordinationClue ||
        o.actorAnalysis?.coordinationSignal ||
        o.actorAnalysis?.sharedFundingSellerGroups?.some(g => Number(g.walletCount || g.wallets?.length || 0) >= 2) ||
        o.actorAnalysis?.deployerLinkedExit ||
        Number(o.actorAnalysis?.earlySellerCount||0)>=2
      );
      if(!relationshipClue)return {ok:false,reason:"There is not yet a meaningful concentration or relationship clue to justify wallet tracing."};
      if(o.walletCluster)return {ok:false,reason:"Wallet relationships have already been inspected."};
    }
    if(action==="inspect_sell_sequence"){
      if(!o.holders)return {ok:false,reason:"Selling behaviour cannot be investigated before holder distribution."};
      if(!o.walletCluster && !o.actorAnalysis?.coordinationClue && !o.actorAnalysis?.sharedFundingSellerGroups?.length)return {ok:false,reason:"No wallet relationship or coordination clue has been established."};
      if(o.sellSequence)return {ok:false,reason:"Selling behaviour has already been inspected."};
    }
    if(action==="inspect_actor_behavior"){
      if(!o.holders)return {ok:false,reason:"Actor behaviour cannot be investigated before holder distribution."};
      if(o.actorAnalysis)return {ok:false,reason:"Actor behaviour has already been inspected."};
      const actorNeeded=Boolean(o.holders.sellerCount||o.holders.sharedFundingSources?.length||o.holders.deployerFundedWallets?.length);
      if(!actorNeeded)return {ok:false,reason:"There is not yet a seller, funding, or deployer-linked clue requiring actor analysis."};
    }
    if(action==="inspect_liquidity"){
      const initial=!o.initialLiquidity;
      const final=Boolean(o.sellSequence?.coordinated);
      if(!initial&&!final)return {ok:false,reason:"Liquidity was already inspected and there is no new event that justifies a re-check."};
      if(final&&o.finalLiquidity)return {ok:false,reason:"Final liquidity has already been inspected."};
    }
    return {ok:true,reason:"Action is valid for the current investigation state."};
  }
}

function decision(action,reason,question){return{action,reason,question}}

export class InvestigationPlanner{
next(state){
const o=state.observations;
if(!o.token)return decision("inspect_token","The token has not been established yet.","What token, deployer, and basic identity details are we investigating?");
if(!o.initialLiquidity)return decision("inspect_liquidity","The initial liquidity position has not been established.","How much liquidity exists, which pool is primary, and what market context is available?");
if(!o.holders)return decision("inspect_holders","Holder distribution is still unknown.","Who holds the supply, who bought versus received it, and where is the meaningful concentration?");
if(o.holders.supported===false){
  const exhausted=["unsupported","unsupported_by_provider","unsupported_by_current_foundational_endpoint","unsupported_by_current_endpoint","capability_exhausted"].includes(o.holders.reason);
  if(!exhausted)return decision("inspect_holders","Holder evidence was unavailable, so another holder attempt is required before the path can be exhausted.","Can holder distribution be obtained from another available evidence source?");
}
const concentrated=Number(o.holders.concentratedShare||0)>=.30||Number(o.holders.top5Share||0)>=.50;
const relationshipClue=Boolean(
  concentrated ||
  o.actorAnalysis?.coordinationClue ||
  o.actorAnalysis?.coordinationSignal ||
  o.actorAnalysis?.sharedFundingSellerGroups?.some(g => Number(g.walletCount || g.wallets?.length || 0) >= 2) ||
  o.actorAnalysis?.deployerLinkedExit ||
  Number(o.actorAnalysis?.earlySellerCount||0)>=2
);
if(relationshipClue&&!o.walletCluster)return decision("inspect_wallet_cluster","Concentration is not the only relationship signal. Shared funding, deployer links, or coordinated seller clues justify tracing the wallets even when no single wallet dominates supply.","Are the relevant wallets connected through common funding, deployer distribution, timing, or another relationship?");
if(o.walletCluster && (o.walletCluster.strongCluster || o.actorAnalysis?.coordinationClue || o.actorAnalysis?.sharedFundingSellerGroups?.length || o.actorAnalysis?.deployerLinkedExit || o.actorAnalysis?.earlySellerCount>=2) && !o.sellSequence)return decision("inspect_sell_sequence","Wallet relationships, deployer-linked exits, or early-seller clues require a direct comparison of selling behaviour.","Did the connected, deployer-linked, or early seller wallets sell in a coordinated sequence?");
if(o.sellSequence?.coordinated&&!o.finalLiquidity)return decision("inspect_liquidity","Coordinated selling was detected; liquidity should be re-checked for an exit event.","Was liquidity removed after the coordinated selling?");
const actorNeeded=Boolean(o.holders.sellerCount||o.holders.sharedFundingSources?.length||o.holders.deployerFundedWallets?.length);
if(actorNeeded&&!o.actorAnalysis)return decision("inspect_actor_behavior","Holder data contains seller, funding, or deployer-linked clues that need to be separated into legitimate distribution versus suspicious extraction.","Did the deployer or early holders distribute, acquire, or sell tokens in a pattern consistent with an intentional exit?");
return decision("finish","The required investigation paths have been resolved for the available evidence.","Has Autopsy exhausted the evidence needed to distinguish a rug from ordinary market deterioration?");
}}

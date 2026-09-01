import{createTools}from"./tools/autopsyTools.js";
import{InvestigationPlanner}from"./planner.js";
import{LLMPlanner}from"./llm/llmPlanner.js";
import{GroqPlanner}from"./llm/groqPlanner.js";
import{mapEvidenceToScene}from"./scene/sceneMapper.js";
import{ActionGuard}from"./guard.js";
import{assessSufficiency,verdictFromEvidence}from"./investigation.js";

export class AutopsyAgent{
constructor(caseData,{fallbackPlanner=new InvestigationPlanner(),aiPlanner=new LLMPlanner(),groqPlanner=new GroqPlanner(),onEvent=()=>{}}={}){
this.caseData=caseData;this.tools=caseData.tools||createTools(caseData);
this.fallbackPlanner=fallbackPlanner;this.aiPlanner=aiPlanner;this.groqPlanner=groqPlanner;this.onEvent=onEvent;this.guard=new ActionGuard();
this.state={toolHistory:[],observations:{},evidence:[],events:[],decisions:[]};
}

log(x){this.state.events.push(x);try{this.onEvent(x)}catch{}}

addEvidence(e){if(!this.state.evidence.some(x=>x.type===e.type&&x.title===e.title))this.state.evidence.push({id:`E${String(this.state.evidence.length+1).padStart(2,"0")}`,...e})}

observe(r){
const f=r.facts||{};
if(r.tool==="inspect_token"){
  const established=Boolean(f.established||(f.ca&&f.deployer));
  this.state.observations.token={...f,established};

  if(established){
    this.addEvidence({
      type:"token_deployment",
      title:"Token contract established",
      details:f.deployer
        ? `Contract ${f.ca} was established with earliest observed activity from ${f.deployer}.`
        : `Contract ${f.ca} was located and token metadata was established from provider data.`,
      confidence:"high"
    });

    this.log("OBSERVATION → token established");
  }else{
    this.log("OBSERVATION → token could not be established from available provider data");
  }
}
if(r.tool==="inspect_liquidity"){
if(!this.state.observations.initialLiquidity){
this.state.observations.initialLiquidity=f;
if(f.pair&&!this.state.observations.token?.established){
this.state.observations.marketEstablished=true;
this.log("OBSERVATION → token established through market evidence");
}
if(f.pair){
this.addEvidence({type:"liquidity_pool",title:"Liquidity pool located",details:`Primary pool ${f.pair} on ${f.dex||"a detected DEX"} currently reports ${f.currentLiquidityUsd==null?"unknown":`$${Number(f.currentLiquidityUsd).toLocaleString()}`} liquidity.`,confidence:"high"});
this.log("OBSERVATION → liquidity pool located")
}else this.log("OBSERVATION → no liquidity pool located")
}else{
this.state.observations.finalLiquidity=f;
if(f.removalRatio!=null&&f.removalRatio>=.75){
this.addEvidence({type:"liquidity_exit",title:"Liquidity leaves the pool",details:`${Math.round(f.removalRatio*100)}% of the initially observed liquidity was removed.`,confidence:"high"});
this.log("OBSERVATION → major liquidity removal detected")
}else if(f.burnEventCount>0){
this.addEvidence({type:"liquidity_exit",title:"Liquidity removal events detected",details:`Provider data shows ${f.burnEventCount} liquidity-removal event(s) on the primary pool.`,confidence:"medium"});
this.log("OBSERVATION → liquidity removal events detected")
}else this.log("OBSERVATION → no confirmed liquidity removal detected")
}}
if(r.tool==="inspect_holders"){
  this.state.observations.holders=f;
  if(f.supported===false){
    this.log(`OBSERVATION → holder analysis unavailable: ${f.reason||"provider capability unavailable"}`)
  } else {
    if(f.topHolderShare!=null){
      this.addEvidence({
        type:"holder_distribution",
        title:"Holder distribution established",
        details:`Top holder controls ${Math.round(Number(f.topHolderShare)*100)}% of supply; top 5 control ${Math.round(Number(f.top5Share||0)*100)}%. ${f.effectiveHolderCount||f.walletCount||0} effective holder(s) were available for analysis.`,
        confidence:"high"
      });
    }
    if(f.sellerCount>0){
      this.addEvidence({
        type:"seller_activity",
        title:"Material seller activity identified",
        details:`${f.sellerCount} holder wallet(s) have recorded selling activity, with ${f.materialSellerCount||0} meeting the material-exit threshold. Their positions represent about ${Math.round(Number(f.materialSellerShare||0)*100)}% of observed supply.`,
        confidence:"high"
      });
    }
    if(f.topHolderExit){
      this.addEvidence({
        type:"top_holder_exit",
        title:`Top-holder selling detected${f.topHolderClusterExit?" across multiple wallets":""}`,
        details:`${f.topHolderSellerCount||1} of the top 5 holders show material selling activity, representing about ${Math.round(Number(f.topHolderSellerShare||0)*100)}% of supply among those top holders. A single large-holder exit is treated as risk evidence, not automatic proof of a rug.`,
        confidence:f.topHolderClusterExit?"high":"medium"
      });
      this.log("OBSERVATION → top-holder selling evidence recorded");
    }
    if(f.sharedFundingSources?.length){
      const largest=[...f.sharedFundingSources].sort((a,b)=>b.walletCount-a.walletCount)[0];
      this.addEvidence({
        type:"shared_funding_source",
        title:"Shared funding relationship identified",
        details:`${largest.walletCount} holder wallet(s) trace to the same funding source ${largest.funder}. Funding relationships are investigated separately from supply concentration.`,
        confidence:largest.walletCount>=3?"high":"medium"
      });
    }
    if(f.concentratedShare>=.30&&f.concentratedWalletCount>=4){
      this.addEvidence({
        type:"wallet_concentration",
        title:`${f.concentratedWalletCount} wallets receive ${Math.round(f.concentratedShare*100)}% of supply`,
        details:"Multiple wallets accumulated a concentrated share shortly after deployment.",
        confidence:"high"
      });
      this.log("OBSERVATION → supply concentration detected")
    }else this.log("OBSERVATION → no major concentration signal")
  }
}
if(r.tool==="inspect_wallet_cluster"){
const largest=f.clusters?.[0],strongCluster=!!largest&&largest.wallets.length>=4&&largest.share>=.30;
this.state.observations.walletCluster={...f,strongCluster};
if(largest){
this.addEvidence({type:"wallet_relationship",title:"Connected wallet relationship traced",details:`${largest.wallets.length} wallet(s) trace to funding source ${largest.funder||"unknown"} and represent about ${Math.round(Number(largest.share||0)*100)}% of the observed holder supply. The relationship was traced rather than inferred from concentration alone.`,confidence:strongCluster?"high":"medium"});
this.log(strongCluster?"OBSERVATION → strong common funding cluster found":"OBSERVATION → deep wallet relationship traced")
}else this.log("OBSERVATION → no strong wallet cluster found")
}
if(r.tool==="inspect_sell_sequence"){
this.state.observations.sellSequence=f;
if(f.count>0){
this.addEvidence({type:"sell_activity_sequence",title:"Seller activity sequence reviewed",details:f.coordinated?"Connected wallets show a repeated trading sequence supported by provider transaction data.":`${f.count} likely sell/trade event(s) were reviewed. ${f.coordinationStatus||"The available sequence does not establish coordination."}`,confidence:f.coordinated?"high":"medium"});
}
if(f.coordinated){
this.addEvidence({type:"coordinated_selling",title:"Coordinated selling pattern detected",details:"Connected wallets show a repeated trading sequence supported by provider transaction data.",confidence:"high"});
this.log("OBSERVATION → coordinated selling pattern detected")
}else this.log("OBSERVATION → no confirmed coordinated selling pattern")
}
if(r.tool==="inspect_actor_behavior"){
  this.state.observations.actorAnalysis=f;

  if(f.deployerExit){
    this.addEvidence({type:"deployer_exit",title:"Deployer selling activity detected",details:f.deployerExitDetails||"The deployer appears in observed selling activity.",confidence:"high"});
    this.log("OBSERVATION → deployer selling signal detected");
  }

  if(f.deployerLinkedExit){
    this.addEvidence({type:"deployer_distribution",title:"Deployer-distributed wallets later sold",details:f.deployerLinkedExitDetails||"Wallets receiving tokens from the deployer later disposed of a material portion.",confidence:"high"});
    this.log("OBSERVATION → deployer-linked selling signal detected");
  } else if(f.deployerFundedWallets?.length){
    this.addEvidence({type:"deployer_distribution",title:"Deployer distributed tokens to external wallets",details:`${f.deployerFundedWallets.length} wallet(s) appear linked to the deployer as a funding source. This may represent airdrops, allocations, or wallet distribution; it is a caution signal, not proof of a rug.` ,confidence:"low"});
    this.log("OBSERVATION → deployer distribution caution recorded");
  }

  if(f.topHolderExit && !this.state.evidence.some(e=>e.type==="top_holder_exit")){
    this.addEvidence({type:"top_holder_exit",title:`Top-holder selling detected${f.topHolderClusterExit?" across multiple wallets":""}`,details:`${f.topHolderSellerCount||1} of the top 5 holders show material selling activity.`,confidence:f.topHolderClusterExit?"high":"medium"});
  }

  if(f.deployerFundedCount>0){
    this.addEvidence({type:"deployer_funding_map",title:"Deployer funding relationships reviewed",details:`${f.deployerFundedCount} holder wallet(s) are linked to the deployer as a funding source; ${f.deployerFundedSellerCount||0} of them show material selling activity. Distribution alone is not treated as proof because it may represent allocations or airdrops.`,confidence:f.deployerFundedSellerCount>0?"high":"medium"});
  }

  if(f.earlySellerCount>0){
    this.addEvidence({type:"early_holder_dump",title:"Early-holder selling detected",details:f.earlyHolderDumpDetails||`${f.earlySellerCount} early holder(s) show material selling activity. This can be profit-taking or a coordinated exit and requires relationship/timing analysis.`,confidence:f.earlyHolderDump?"high":"low"});
    this.log("OBSERVATION → early-holder selling evidence recorded");
  }

  if(f.sharedFundingSellerGroups?.length){
    const strongest=f.largestSharedSellerGroup || f.sharedFundingSellerGroups[0];
    const enriched=f.sharedFundingSellerGroups.find(g=>String(g.funder||"").toLowerCase()===String(strongest.funder||"").toLowerCase())||strongest;
    this.addEvidence({type:"shared_funding_sellers",title:"Shared funding connects active sellers",details:`${strongest.wallets?.length||strongest.walletCount||0} selling wallet(s) share funding source ${strongest.funder}. ${enriched.materialSellerCount!=null?`${enriched.materialSellerCount} meet the material-exit threshold and represent about ${Math.round(Number(enriched.materialSellerShare||0)*100)}% of supply.`:"Shared funding alone does not prove coordination."}`,confidence:(f.sharedFundingSellerGroups.some(g => (g.wallets?.length||g.walletCount||0)>=3))?"high":"medium"});
    if(enriched.fundingBeforeBuy>0){
      this.addEvidence({type:"funding_before_buy",title:"Funding preceded token activity",details:`${enriched.fundingBeforeBuy} wallet(s) in the traced seller group received their observed funding before their first token activity, strengthening the economic-link analysis.`,confidence:"medium"});
    }
    this.log("OBSERVATION → shared-funding seller relationship recorded");
  }

  if(f.sharedFundingDump){
    const strongest=[...(f.sharedFundingSellerGroups||[])].sort((a,b)=>(b.materialSellerCount||0)-(a.materialSellerCount||0))[0];
    this.addEvidence({type:"shared_funding_dump",title:"Shared-funded wallets materially exited",details:`A shared funding group had ${strongest?.materialSellerCount||0} material sellers${strongest?.soldFraction!=null?` with an aggregate sell/buy ratio of about ${Math.round(Number(strongest.soldFraction)*100)}%`:""}. This is treated as a group-exit signal and evaluated alongside timing, holder rank, and deployer evidence.`,confidence:"high"});
    this.log("OBSERVATION → shared-funding group exit signal detected");
  }

  if(f.coordinationSignal){
    this.addEvidence({type:"coordination_signal",title:"Potential coordinated seller group",details:"Multiple early sellers share a funding relationship and exhibit material selling behaviour. The pattern is suspicious, but coordination is treated as a signal rather than proof of malicious intent until the selling sequence is corroborated.",confidence:"high"});
    this.log("OBSERVATION → coordination signal detected");
  }

  if(f.rpcDeployerTransfers?.length){
    this.addEvidence({type:"deployer_distribution",title:"Deployer transferred tokens to external wallets",details:`RPC history observed ${f.rpcDeployerTransfers.length} deployer token transfer transaction(s). Transfers can represent airdrops, allocations, or wallet distribution; subsequent recipient behaviour determines whether the pattern becomes suspicious.`,confidence:"medium"});
    this.log("OBSERVATION → deployer distribution activity observed");
  }

  if(f.cautions?.length){
    this.addEvidence({type:"actor_caution",title:"Actor behaviour requires caution",details:f.cautions.join(" "),confidence:"low"});
    this.log("OBSERVATION → actor caution recorded");
  }

  if(!f.deployerExit&&!f.deployerLinkedExit&&!f.earlySellerCount&&!f.sharedFundingSellerGroups?.length&&!f.rpcDeployerTransfers?.length&&!f.cautions?.length){
    this.log("OBSERVATION → no additional actor-risk signal");
  }
}
}

runTool(action){
const methods={inspect_token:"inspectToken",inspect_liquidity:"inspectLiquidity",inspect_holders:"inspectHolders",inspect_wallet_cluster:"inspectWalletCluster",inspect_sell_sequence:"inspectSellSequence",inspect_actor_behavior:"inspectActorBehavior"};
if(action==="finish")return null;
const method=methods[action];if(!method)throw new Error(`Unknown investigation action: ${action}`);
return this.tools[method](this.state);
}

async askPlanner(planner,label,snapshot){
if(!planner?.enabled)return null;
this.log(`AI PLANNER → ${label} querying`);
const decision=await planner.next(snapshot);
if(decision){
this.log(`AI PLANNER → ${label} decision received`);
return decision;
}
this.log(`AI PLANNER → ${label} unavailable or invalid`);
return null;
}

async choosePlan(){
const snapshot={token:this.state.observations.token||this.caseData.token,observations:this.state.observations,toolHistory:this.state.toolHistory,evidence:this.state.evidence};

for(const [planner,label,source] of [[this.aiPlanner,"Gemini","llm"],[this.groqPlanner,"Groq","groq"]]){
  const decision=await this.askPlanner(planner,label,snapshot);
  if(decision){
    const check=this.guard.validate(decision.action,this.state);
    if(check.ok)return {...decision,source};
    this.log(`ACTION GUARD → rejected ${label} action: ${check.reason}`);
  }
}

this.log("AI PLANNER → using deterministic fallback");
const fallback=this.fallbackPlanner.next(this.state);
const check=this.guard.validate(fallback.action,this.state);
if(!check.ok)throw new Error(`Fallback planner proposed an invalid action: ${check.reason}`);
return{...fallback,source:"fallback"};
}

async run(){
this.log("INVESTIGATION STARTED");
while(true){
const plan=await this.choosePlan();
this.state.decisions.push({step:this.state.decisions.length+1,...plan});
this.log(`REASONING [${plan.source}] → ${plan.reason}`);
this.log(`ACTION → ${plan.action}`);
if(plan.action==="finish"){this.log("PLAN → enough evidence collected");break}
this.state.toolHistory.push(plan.action);
this.log(`PROVIDER → executing ${plan.action}`);
this.observe(await this.runTool(plan.action));
}
this.log("REASONING → comparing independent signals");
const verdict=this.buildVerdict();
this.log(`VERDICT → ${verdict.label.toUpperCase()}`);
const sceneEvidence=mapEvidenceToScene(this.state.evidence);
const debrief={
  headline: verdict.explanation,
  verdictBasis: (verdict.contributions||[]).map(x=>({signal:x.signal,points:x.points})),
  cautions: verdict.cautions||[],
  counterEvidence: verdict.counterEvidence||[],
  findings: this.state.evidence.map(e=>({id:e.id,title:e.title,details:e.details,confidence:e.confidence})),
  conclusion: verdict.label === "rug"
    ? `${verdict.classification}: the final rug score is supported by the observed evidence above. Individual cautions are not treated as proof on their own.`
    : verdict.classification === "suspicious_deployer_distribution_unproven"
      ? "Deployer-linked distribution was observed, but subsequent selling evidence was not strong enough to call it a proven rug."
      : verdict.label === "not_rug"
        ? "No independent rug-pattern signal was established. The observed decline should not be presented as a proven planned rug."
        : "The investigation did not gather enough evidence to reach a defensible conclusion."
};
return{agent:"on-chain-autopsy-agent",version:"stage-2.9-investigator-v2",input:this.caseData.token.ca,verdict,evidence:this.state.evidence,scene:{markers:sceneEvidence,markerCount:sceneEvidence.length,primaryAnchorCount:8},debrief,investigation:{decisions:this.state.decisions,toolHistory:this.state.toolHistory,eventLog:this.state.events,sufficiency:verdict.sufficiency}};
}

buildVerdict(){
return verdictFromEvidence(this.state.observations,assessSufficiency(this.state.observations));
}
}

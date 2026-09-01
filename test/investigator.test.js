import test from "node:test";
import assert from "node:assert/strict";
import {AutopsyAgent} from "../src/agent.js";
import {cases} from "../src/data/cases.js";
import {verdictFromEvidence,assessSufficiency} from "../src/investigation.js";

test("no rug signals do not produce a rug verdict",()=>{
 const o={token:{established:true},initialLiquidity:{pair:"X"},holders:{supported:true,concentratedShare:.1,top5Share:.2}};
 const v=verdictFromEvidence(o,assessSufficiency(o));
 assert.equal(v.label,"not_rug");
 assert.equal(v.independentSignals,0);
});

test("meaningful red flags without strict convergence produce suspicious, not not_rug",()=>{
 const o={token:{established:true},initialLiquidity:{pair:"X"},holders:{supported:true,concentratedShare:.1,top5Share:.2},actorAnalysis:{sharedFundingDump:true},walletCluster:{strongCluster:false},sellSequence:{coordinated:false}};
 const v=verdictFromEvidence(o,assessSufficiency(o));
 assert.equal(v.label,"suspicious");
 assert.equal(v.classification,"suspicious_activity_unproven");
});

test("deployer-linked seller evidence can produce a rug signal",()=>{
 const o={token:{established:true},initialLiquidity:{pair:"X"},holders:{supported:true,concentratedShare:.1,top5Share:.2},actorAnalysis:{deployerLinkedExit:true},walletCluster:{strongCluster:false},sellSequence:{coordinated:false}};
 const v=verdictFromEvidence(o,assessSufficiency(o));
 assert.equal(v.label,"rug");
 assert.equal(v.signals.deployerLinkedExit,true);
});

test("AICORE fixture still produces multiple independent signals",async()=>{
 const a=new AutopsyAgent(cases.AICORE,{aiPlanner:{enabled:false},groqPlanner:{enabled:false}});
 const r=await a.run();
 assert.equal(r.verdict.label,"rug");
 assert.ok(r.verdict.independentSignals>=3);
 assert.equal(r.scene.markerCount,r.evidence.length);
 assert.ok(r.debrief.findings.length>0);
});

test("deployer distribution is cautionary until linked selling is established",async()=>{
 const a=new AutopsyAgent({
  token:{ca:"X",deployer:"DEV",established:true},
  tools:{
   inspectToken:()=>({tool:"inspect_token",facts:{ca:"X",deployer:"DEV",established:true}}),
   inspectLiquidity:()=>({tool:"inspect_liquidity",facts:{pair:"X/ETH",currentLiquidityUsd:100}}),
   inspectHolders:()=>({tool:"inspect_holders",facts:{supported:true,concentratedShare:.1,top5Share:.2,sellerCount:2,wallets:[]}}),
   inspectActorBehavior:()=>({tool:"inspect_actor_behavior",facts:{supported:true,deployer:"DEV",deployerExit:false,deployerLinkedExit:false,earlyHolderDump:false,rpcDeployerTransfers:[{txHash:"tx1"}],cautions:["Deployer transfer may be an allocation."]}})
  }
 },{aiPlanner:{enabled:false},groqPlanner:{enabled:false}});
 const r=await a.run();
 assert.equal(r.verdict.label,"not_rug");
 assert.ok(r.evidence.some(e=>e.type==="deployer_distribution"));
 assert.ok(r.debrief.findings.some(e=>e.title.includes("Deployer transferred")));
});

test("actor clues are converted into evidence and scene markers",async()=>{
 const a=new AutopsyAgent({
  token:{ca:"X",deployer:"DEV",established:true},
  tools:{
   inspectToken:()=>({tool:"inspect_token",facts:{ca:"X",deployer:"DEV",established:true}}),
   inspectLiquidity:()=>({tool:"inspect_liquidity",facts:{pair:"X/ETH",currentLiquidityUsd:100}}),
   inspectHolders:()=>({tool:"inspect_holders",facts:{supported:true,concentratedShare:.12,top5Share:.24,sellerCount:4,wallets:[]}}),
   inspectActorBehavior:()=>({tool:"inspect_actor_behavior",facts:{supported:true,deployer:"DEV",deployerExit:false,deployerLinkedExit:false,earlySellerCount:3,earlyHolderDump:false,sharedFundingSellerGroups:[{funder:"FUNDER",wallets:["A","B","C"],walletCount:3}],coordinationClue:true,coordinationSignal:false,cautions:["Distribution may be an allocation."]}}),
   inspectWalletCluster:()=>({tool:"inspect_wallet_cluster",facts:{clusters:[{funder:"FUNDER",wallets:["A","B","C"],share:.12}],strongCluster:false}}),
   inspectSellSequence:()=>({tool:"inspect_sell_sequence",facts:{count:3,coordinated:true,sequence:[]}})
  }
 },{aiPlanner:{enabled:false},groqPlanner:{enabled:false}});
 const r=await a.run();
 assert.ok(r.evidence.some(e=>e.type==="wallet_relationship"));
 assert.ok(r.evidence.some(e=>e.type==="early_holder_dump"));
 assert.ok(r.scene.markerCount===r.evidence.length);
 assert.ok(r.debrief.findings.length>=3);
});

test("coordination can require wallet tracing without high concentration",()=>{
 const o={token:{established:true},initialLiquidity:{pair:"X"},holders:{supported:true,concentratedShare:.12,top5Share:.24},actorAnalysis:{coordinationClue:true}};
 const s=assessSufficiency(o);
 assert.ok(s.blockers.includes("wallet_relationship_uninspected"));
});

test("shared funding seller coordination becomes a rug signal only when corroborated",()=>{
 const base={token:{established:true},initialLiquidity:{pair:"X"},holders:{supported:true,concentratedShare:.1,top5Share:.2},actorAnalysis:{sharedFundingSellerGroups:[{funder:"F",wallets:["A","B","C"],walletCount:3}],coordinationSignal:true},walletCluster:{strongCluster:false},sellSequence:{coordinated:true},finalLiquidity:{removalRatio:0}};
 const v=verdictFromEvidence(base,assessSufficiency(base));
 assert.equal(v.signals.coordinatedSelling,true);
 assert.equal(v.label,"rug");
 assert.equal(v.classification,"coordinated_early_holder_dump");
});

test("deployer-linked exit outweighs uncorroborated shared funding and preserves cautions",()=>{
 const o={token:{established:true},initialLiquidity:{pair:"X"},holders:{supported:true,concentratedShare:.12,top5Share:.24},actorAnalysis:{deployerLinkedExit:true,deployerFundedWallets:[{wallet:"A"}],sharedFundingSellerGroups:[{funder:"F",wallets:["A","B","C"],walletCount:3}]},walletCluster:{strongCluster:false},sellSequence:{coordinated:false}};
 const v=verdictFromEvidence(o,assessSufficiency(o));
 assert.equal(v.label,"rug");
 assert.equal(v.classification,"planned_insider_rug");
 assert.ok(v.contributions.some(x=>x.signal==="deployerLinkedExit"));
 assert.ok(v.cautions.some(x=>x.signal==="shared_funding"));
 assert.ok(v.counterEvidence.some(x=>x.type==="no_confirmed_coordination"));
});

test("organic selling with shared funding is suspicious without corroboration",()=>{
 const o={token:{established:true},initialLiquidity:{pair:"X"},holders:{supported:true,concentratedShare:.12,top5Share:.24,sellerCount:5},actorAnalysis:{sharedFundingSellerGroups:[{funder:"F",wallets:["A","B","C"],walletCount:3}],earlySellerCount:2,earlyHolderDump:false},walletCluster:{strongCluster:false},sellSequence:{coordinated:false}};
 const v=verdictFromEvidence(o,assessSufficiency(o));
 assert.equal(v.label,"suspicious");
 assert.equal(v.classification,"suspicious_activity_unproven");
 assert.equal(v.signals.coordinatedSelling,false);
 assert.ok(v.cautions.length>=1);
});

test("liquidity exit plus coordinated selling receives corroboration bonus",()=>{
 const o={token:{established:true},initialLiquidity:{pair:"X",removalRatio:.8},holders:{supported:true,concentratedShare:.1,top5Share:.2},walletCluster:{strongCluster:true},sellSequence:{coordinated:true},finalLiquidity:{removalRatio:.8}};
 const v=verdictFromEvidence(o,assessSufficiency(o));
 assert.equal(v.label,"rug");
 assert.equal(v.classification,"coordinated_liquidity_exit");
 assert.ok(v.score>=50);
 assert.ok(v.confidence>.65);
});

test("rich actor evidence exposes multiple real findings without changing verdict semantics",async()=>{
 const a=new AutopsyAgent({
  token:{ca:"X",deployer:"DEV",established:true},
  tools:{
   inspectToken:()=>({tool:"inspect_token",facts:{ca:"X",deployer:"DEV",established:true}}),
   inspectLiquidity:()=>({tool:"inspect_liquidity",facts:{pair:"X/ETH",currentLiquidityUsd:2500}}),
   inspectHolders:()=>({tool:"inspect_holders",facts:{supported:true,topHolderShare:.18,top5Share:.38,concentratedShare:.38,concentratedWalletCount:5,sellerCount:6,materialSellerCount:5,materialSellerShare:.31,topHolderExit:true,topHolderClusterExit:true,topHolderSellerCount:2,topHolderSellerShare:.27,sharedFundingSources:[{funder:"FUNDER",wallets:["A","B","C","D"],walletCount:4}],wallets:[]}}),
   inspectActorBehavior:()=>({tool:"inspect_actor_behavior",facts:{supported:true,deployer:"DEV",deployerExit:false,deployerLinkedExit:false,deployerFundedCount:0,deployerFundedSellerCount:0,topHolderExit:true,topHolderClusterExit:true,topHolderSellerCount:2,earlySellerCount:3,earlyHolderDump:true,sharedFundingSellerGroups:[{funder:"FUNDER",wallets:["A","B","C","D"],walletCount:4,materialSellerCount:4,materialSellerShare:.31,soldFraction:.91,fundingBeforeBuy:4}],sharedFundingDump:true,coordinationClue:true,coordinationSignal:true,cautions:[]}}),
   inspectWalletCluster:()=>({tool:"inspect_wallet_cluster",facts:{clusters:[{funder:"FUNDER",wallets:["A","B","C","D"],share:.31}],strongCluster:true}}),
   inspectSellSequence:()=>({tool:"inspect_sell_sequence",facts:{count:4,coordinated:true,sequence:[],coordinationStatus:"Seller activity spans 12 minutes."}})
  }
 },{aiPlanner:{enabled:false},groqPlanner:{enabled:false}});
 const r=await a.run();
 assert.equal(r.verdict.label,"rug");
 assert.ok(r.evidence.length>=8);
 assert.ok(r.evidence.some(e=>e.type==="top_holder_exit"));
 assert.ok(r.evidence.some(e=>e.type==="shared_funding_dump"));
 assert.ok(r.evidence.some(e=>e.type==="funding_before_buy"));
 assert.equal(r.scene.markerCount,r.evidence.length);
});

test("a single top-holder exit remains suspicious, not an automatic rug",()=>{
 const o={token:{established:true},initialLiquidity:{pair:"X"},holders:{supported:true,topHolderShare:.18,top5Share:.32},actorAnalysis:{topHolderExit:true,topHolderClusterExit:false},walletCluster:{strongCluster:false},sellSequence:{coordinated:false}};
 const v=verdictFromEvidence(o,assessSufficiency(o));
 assert.equal(v.label,"suspicious");
 assert.ok(v.cautions.some(x=>x.signal==="top_holder_exit"));
});

import {cases} from "./data/cases.js";
import {AutopsyAgent} from "./agent.js";
import {normalizeInput,isFixtureKey} from "./input.js";
import {createGoldRushTools,GoldRushProvider} from "./providers/goldrush.js";
import {createCoinMarketCapTools,CoinMarketCapProvider} from "./providers/coinmarketcap.js";
import {createRpcTools,RpcProvider} from "./providers/rpc.js";

const raw=process.argv[2];
const chainOverride=process.argv[3];

if(!raw){
  console.error("Usage: npm run dev -- <TOKEN_CA> [chain]");
  console.error("Example: npm run dev -- 0x... eth-mainnet");
  console.error("Fixture tests: npm run dev -- AICORE");
  process.exit(1);
}

let c;

if(isFixtureKey(raw)){
  c=cases[String(raw).toUpperCase()];
}else{
  try{
    const input=normalizeInput(raw,chainOverride);

    const goldrushProvider=new GoldRushProvider();
    const goldrushTools=createGoldRushTools(input,goldrushProvider);

    const cmcProvider=new CoinMarketCapProvider();
    const cmcTools=createCoinMarketCapTools(input,cmcProvider);

    const rpcProvider=new RpcProvider();
    const rpcTools=createRpcTools(input,rpcProvider);

    const tools={
      ...goldrushTools,
      ...(rpcProvider.enabled(input.chain) ? {
        inspectToken:async()=>{
          const [gold,rpc]=await Promise.all([goldrushTools.inspectToken(),rpcTools.inspectToken()]);
          return {tool:"inspect_token",facts:{...(gold?.facts||{}),...(rpc?.facts||{}),
            deployer:rpc?.facts?.deployer||gold?.facts?.deployer||null,
            rpcVerified:rpc?.facts?.rpcVerified??false
          }};
        },
        inspectActorBehavior:async(state)=>{
          const base=input.chain==="solana-mainnet"?cmcTools.inspectActorBehavior(state):goldrushTools.inspectActorBehavior(state);
          const [primary,rpc]=await Promise.all([base,rpcTools.inspectActorBehavior(state)]);
          const a=primary?.facts||{}; const r=rpc?.facts||{};
          return {tool:"inspect_actor_behavior",facts:{...a,...r,
            supported:Boolean(a.supported!==false||r.supported),
            deployer:r.deployer||a.deployer||null,
            deployerExit:Boolean(a.deployerExit||r.deployerPossibleSaleCount>0),
            deployerExitDetails:a.deployerExitDetails||(r.deployerPossibleSaleCount>0?`${r.deployerPossibleSaleCount} possible deployer sale transaction(s) were observed in RPC history; these require transaction-level interpretation before being treated as proof of an exit.`:null),
            deployerLinkedExit:Boolean(a.deployerLinkedExit),
            earlyHolderDump:Boolean(a.earlyHolderDump),
            cautions:[...(a.cautions||[]),...(r.deployerTransferCount? [`RPC observed ${r.deployerTransferCount} token transfer transaction(s) from the deployer. Transfers can represent airdrops, allocations, or wallet distribution and are not proof of a rug by themselves.`]:[])],
            rpcDeployerTransfers:r.deployerTransfers||[],
            rpcPossibleSales:r.possibleSales||[]
          }};
        }
      } : {}),

      // Solana holder analysis is routed through CMC because
      // GoldRush Foundational does not currently expose the
      // required token-holder snapshot endpoint for Solana.
      ...(input.chain==="solana-mainnet"
        ? {inspectHolders:cmcTools.inspectHolders,inspectActorBehavior:cmcTools.inspectActorBehavior}
        : {inspectActorBehavior:goldrushTools.inspectActorBehavior}),
    };

    c={
      token:{
        ca:input.ca,
        symbol:null,
        name:null,
        deployer:null,
        totalSupply:null,
        chain:input.chain
      },
      tools
    };

  }catch(error){
    console.error(`INPUT ERROR: ${error.message}`);
    process.exit(1);
  }
}

let r;

try{
  r=await new AutopsyAgent(
    c,
    {onEvent:(event)=>console.log(event)}
  ).run();
}catch(error){
  console.error(`\nAUTOPSY ERROR: ${error.message}`);
  process.exit(1);
}

console.log(`\n=== ON-CHAIN AUTOPSY · STAGE 2.9 ===\n`);

for(const event of r.investigation.eventLog){
  console.log(event);
}

console.log("\n=== PLANNER TRACE ===");

for(const d of r.investigation.decisions){
  console.log(`\nSTEP ${d.step} [${d.source}]`);
  console.log(`ACTION: ${d.action}`);
  console.log(`REASON: ${d.reason}`);
  console.log(`QUESTION: ${d.question}`);
}

console.log("\n=== VERDICT ===");

console.log(
  `${r.verdict.label.toUpperCase()} | ` +
  `${Math.round(r.verdict.confidence*100)}% | ` +
  `${r.verdict.independentSignals} independent signals`
);

console.log("\n=== SCENE MARKERS ===");

for(const m of r.scene.markers){
  console.log(
    `${m.id} → ${m.scene.mode}:${m.scene.anchorId} → ${m.title}`
  );
}

console.log("\n=== JSON ===\n");
console.log(JSON.stringify(r,null,2));

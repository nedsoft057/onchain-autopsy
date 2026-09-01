import test from "node:test";
import assert from "node:assert/strict";
import {GroqPlanner} from "../src/llm/groqPlanner.js";
import {AutopsyAgent} from "../src/agent.js";

test("Groq planner is disabled without a key",()=>{
 const p=new GroqPlanner({apiKey:""}); assert.equal(p.enabled,false);
});

test("Groq planner uses the production chat completions endpoint by default",()=>{
 const p=new GroqPlanner({apiKey:"x"}); assert.equal(p.baseUrl,"https://api.groq.com/openai/v1/chat/completions"); assert.equal(p.model,"openai/gpt-oss-20b");
});

test("agent can fall back to deterministic planner when both LLMs are unavailable",async()=>{
 const fakeTools={inspectToken:async()=>({tool:"inspect_token",facts:{ca:"X",established:true}}),inspectLiquidity:async()=>({tool:"inspect_liquidity",facts:{}}),inspectHolders:async()=>({tool:"inspect_holders",facts:{supported:false,reason:"unsupported"}}),inspectWalletCluster:async()=>({tool:"inspect_wallet_cluster",facts:{}}),inspectSellSequence:async()=>({tool:"inspect_sell_sequence",facts:{coordinated:false}})};
 const a=new AutopsyAgent({token:{ca:"X",chain:"solana-mainnet"},tools:fakeTools},{aiPlanner:{enabled:false},groqPlanner:{enabled:false}});
 const r=await a.run(); assert.ok(r.investigation.decisions.every(d=>d.source==="fallback")); assert.equal(r.verdict.label,"not_rug");
});

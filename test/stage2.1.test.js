import test from "node:test";
import assert from "node:assert/strict";
import {ActionGuard} from "../src/guard.js";
import {cases} from "../src/data/cases.js";
import {AutopsyAgent} from "../src/agent.js";
import {offlineAgent} from "../support/helpers.js";

test("guard rejects repeated token inspection",()=>{
  const g=new ActionGuard();
  const state={observations:{token:{symbol:"$AICORE"}}};
  const result=g.validate("inspect_token",state);
  assert.equal(result.ok,false);
});

test("guard rejects wallet cluster without concentration",()=>{
  const g=new ActionGuard();
  const state={observations:{holders:{concentratedShare:.10}}};
  const result=g.validate("inspect_wallet_cluster",state);
  assert.equal(result.ok,false);
});

test("guard allows wallet cluster after strong concentration",()=>{
  const g=new ActionGuard();
  const state={observations:{holders:{concentratedShare:.41}}};
  const result=g.validate("inspect_wallet_cluster",state);
  assert.equal(result.ok,true);
});

test("guard allows final liquidity re-check only after coordinated selling",()=>{
  const g=new ActionGuard();
  const before={observations:{initialLiquidity:{}}};
  const after={observations:{initialLiquidity:{},sellSequence:{coordinated:true}}};
  assert.equal(g.validate("inspect_liquidity",before).ok,false);
  assert.equal(g.validate("inspect_liquidity",after).ok,true);
});

test("full AICORE investigation still passes through the guard",async()=>{
  const r=await offlineAgent(AutopsyAgent,cases.AICORE).run();
  assert.equal(r.verdict.label,"rug");
  assert.equal(r.scene.markerCount,r.evidence.length);
  assert.equal(r.investigation.decisions.length,7);
});

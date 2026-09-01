import test from "node:test";
import assert from "node:assert/strict";
import {LLMPlanner} from "../src/llm/llmPlanner.js";

const baseState={
  token:{ca:"AICORE",symbol:"$AICORE"},
  observations:{token:{symbol:"$AICORE"}},
  toolHistory:["inspect_token"],
  evidence:[]
};

test("Gemini planner is disabled without a key",async()=>{
  const planner=new LLMPlanner({apiKey:"",model:"gemini-3.6-flash"});
  assert.equal(planner.enabled,false);
  assert.equal(await planner.next(baseState),null);
});

test("Gemini planner parses a structured Interactions response",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({
    steps:[{
      type:"model_output",
      content:[{type:"text",text:JSON.stringify({
        action:"inspect_liquidity",
        reason:"The initial liquidity position has not been established.",
        question:"How much liquidity was added and what happened to it?"
      })}]
    }]
  }),{status:200,headers:{"content-type":"application/json"}});

  try{
    const planner=new LLMPlanner({apiKey:"test-key"});
    const result=await planner.next(baseState);
    assert.deepEqual(result,{
      action:"inspect_liquidity",
      reason:"The initial liquidity position has not been established.",
      question:"How much liquidity was added and what happened to it?",
      source:"llm"
    });
  }finally{
    globalThis.fetch=original;
  }
});

test("invalid Gemini action is rejected before the agent can use it",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({
    steps:[{type:"model_output",content:[{type:"text",text:JSON.stringify({
      action:"make_up_a_tool",
      reason:"Invented action",
      question:"Invented question"
    })}]}]
  }),{status:200});

  try{
    const planner=new LLMPlanner({apiKey:"test-key"});
    assert.equal(await planner.next(baseState),null);
  }finally{
    globalThis.fetch=original;
  }
});

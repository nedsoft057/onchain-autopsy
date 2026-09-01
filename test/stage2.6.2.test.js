import test from "node:test";
import assert from "node:assert/strict";
import {GoldRushProvider} from "../src/providers/goldrush.js";

test("GoldRush uses the documented Foundational API base by default",()=>{
  const p=new GoldRushProvider({apiKey:"test"});
  assert.equal(p.baseUrl,"https://api.covalenthq.com/v1");
});

test("Robinhood Chain maps to its GoldRush chain name",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    assert.match(String(url),/robinhood-mainnet/);
    return new Response(JSON.stringify({data:{items:[],pagination:{has_more:false}}}),{status:200});
  };
  try{
    const p=new GoldRushProvider({apiKey:"test",dexEnabled:false});
    const r=await p.holders("robinhood-mainnet","0x0000000000000000000000000000000000000001");
    assert.deepEqual(r.items,[]);
  }finally{
    globalThis.fetch=original;
  }
});

test("non-JSON provider errors remain readable",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response("Unauthorized",{status:401});
  try{
    const p=new GoldRushProvider({apiKey:"test"});
    await assert.rejects(
      p.holders("eth-mainnet","0x0000000000000000000000000000000000000001"),
      err=>err.status===401 && err.message.includes("authentication failed")
    );
  }finally{
    globalThis.fetch=original;
  }
});

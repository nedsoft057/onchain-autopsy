import test from "node:test";
import assert from "node:assert/strict";
import {normalizeInput,isFixtureKey} from "../src/input.js";
import {GoldRushProvider} from "../src/providers/goldrush.js";
import {cases} from "../src/data/cases.js";
import {AutopsyAgent} from "../src/agent.js";
import {LLMPlanner} from "../src/llm/llmPlanner.js";
import {offlineAgent} from "../support/helpers.js";

test("real EVM CA input is normalized",()=>{
  const x=normalizeInput("0x0000000000000000000000000000000000000001","base-mainnet");
  assert.equal(x.family,"evm");
  assert.equal(x.chain,"base-mainnet");
});

test("real Solana mint input is normalized",()=>{
  const x=normalizeInput("So11111111111111111111111111111111111111112");
  assert.equal(x.family,"solana");
  assert.equal(x.chain,"solana-mainnet");
});

test("invalid input fails closed",()=>assert.throws(()=>normalizeInput("AICORE")));

test("fixtures are explicit, not the default",()=>{
  assert.equal(isFixtureKey("AICORE"),true);
  assert.equal(isFixtureKey("0x0000000000000000000000000000000000000001"),false);
});

test("GoldRush provider maps holder data into agent facts",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    assert.match(String(url),/token_holders_v2/);
    return new Response(JSON.stringify({data:{updated_at:"2026-08-26T00:00:00Z",items:[
      {address:"0xA",balance:"600",total_supply:"1000",contract_decimals:0,contract_name:"Test",contract_ticker_symbol:"TEST"},
      {address:"0xB",balance:"200",total_supply:"1000",contract_decimals:0,contract_name:"Test",contract_ticker_symbol:"TEST"},
      {address:"0xC",balance:"100",total_supply:"1000",contract_decimals:0,contract_name:"Test",contract_ticker_symbol:"TEST"}
    ],pagination:{has_more:false}}}),{status:200});
  };
  try{
    const p=new GoldRushProvider({apiKey:"test"});
    const r=await p.inspectHolders("eth-mainnet","0x0000000000000000000000000000000000000001");
    assert.equal(r.facts.walletCount,3);
    assert.equal(r.facts.concentratedShare,.9);
  }finally{globalThis.fetch=original;}
});

test("real runtime never needs fixture data for an explicit CA",async()=>{
  const c={token:{ca:"0x0000000000000000000000000000000000000001",symbol:null,name:null},tools:{
    inspectToken:()=>({tool:"inspect_token",facts:{ca:"0x0000000000000000000000000000000000000001",symbol:"TEST",established:true}}),
    inspectLiquidity:()=>({tool:"inspect_liquidity",facts:{pair:null,removalRatio:null}}),
    inspectHolders:()=>({tool:"inspect_holders",facts:{walletCount:2,concentratedWalletCount:0,concentratedShare:.2,wallets:[]}}),
    inspectWalletCluster:()=>({tool:"inspect_wallet_cluster",facts:{clusters:[],strongCluster:false}}),
    inspectSellSequence:()=>({tool:"inspect_sell_sequence",facts:{count:0,coordinated:false}})
  }};
  const r=await offlineAgent(AutopsyAgent,c).run();
  assert.equal(r.verdict.label,"not_rug");
  assert.equal(typeof r.verdict.score,"number");
  assert.equal(r.evidence.some(x=>x.title?.includes("6 wallets")),false);
});

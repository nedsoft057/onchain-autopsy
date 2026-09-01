import test from "node:test";
import assert from "node:assert/strict";
import {RpcProvider} from "../src/providers/rpc.js";

test("RPC provider stays unavailable when no endpoint is configured",async()=>{
 const p=new RpcProvider({solanaUrl:null,evmUrl:null});
 const r=await p.inspectActorBehavior("solana-mainnet","MINT",{deployer:"DEV"});
 assert.equal(r.facts.supported,false);
});

test("Solana token activity extracts the earliest signer as deployer",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,opts)=>{
  const body=JSON.parse(opts.body);
  let result=null;
  if(body.method==="getTokenSupply") result={value:{amount:"1000000",decimals:6,uiAmount:1}};
  if(body.method==="getTokenLargestAccounts") result={value:[]};
  if(body.method==="getSignaturesForAddress") result=[{signature:"sig1",blockTime:100}];
  if(body.method==="getTransaction") result={transaction:{message:{accountKeys:[{pubkey:"DEPLOYER",signer:true}]}},meta:{}};
  return {ok:true,json:async()=>({result})};
 };
 try{
  const p=new RpcProvider({solanaUrl:"https://rpc.test"});
  const r=await p.inspectToken("solana-mainnet","MINT");
  assert.equal(r.facts.deployer,"DEPLOYER");
  assert.equal(r.facts.rpcVerified,true);
 }finally{globalThis.fetch=original;}
});

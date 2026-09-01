import test from "node:test";
import assert from "node:assert/strict";
import {providerCapabilities, capabilityFor} from "../src/providers/capabilities.js";
import {EvidenceProvider} from "../src/providers/evidenceProvider.js";

test("foundational EVM chains expose holder capability",()=>{
  assert.equal(capabilityFor("eth-mainnet","token_holders"),true);
});

test("Solana does not claim the EVM token-holder endpoint",()=>{
  const caps=providerCapabilities("solana-mainnet");
  assert.equal(caps.family,"solana");
  assert.equal(caps.token_balances,true);
  assert.equal(caps.token_holders,false);
});

test("unsupported holder capability becomes unavailable evidence",async()=>{
  const provider={
    holders:async()=>{throw new Error("should not be called")},
    inspectToken:async()=>({tool:"inspect_token",facts:{established:true}})
  };
  const ep=new EvidenceProvider(provider);
  const r=await ep.inspectHolders("solana-mainnet","Mint");
  assert.equal(r.status,"unavailable");
  assert.equal(r.reason,"unsupported_by_provider");
});

test("provider failure is unavailable, never positive evidence",async()=>{
  const provider={holders:async()=>{const e=new Error("temporary failure");e.status=500;throw e;}};
  const ep=new EvidenceProvider(provider);
  const r=await ep.inspectHolders("eth-mainnet","0xToken");
  assert.equal(r.status,"unavailable");
  assert.equal(r.reason,"provider_error");
  assert.equal(r.facts.chain,"eth-mainnet");
});

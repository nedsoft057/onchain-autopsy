import test from"node:test";import assert from"node:assert/strict";import{cases}from"../src/data/cases.js";import{AutopsyAgent}from"../src/agent.js";import{LLMPlanner}from"../src/llm/llmPlanner.js";import{offlineAgent}from"../support/helpers.js";import{mapEvidenceToScene}from"../src/scene/sceneMapper.js";

test("works without an AI key using fallback planner",async()=>{const r=await offlineAgent(AutopsyAgent,cases.AICORE).run();assert.equal(r.verdict.label,"rug");assert.ok(r.investigation.decisions.every(d=>d.source==="fallback"))});

test("AI planner is disabled without credentials",()=>{const p=new LLMPlanner({apiKey:"",model:"",baseUrl:""});assert.equal(p.enabled,false)});

test("scene markers equal evidence count",async()=>{const r=await offlineAgent(AutopsyAgent,cases.AICORE).run();assert.equal(r.scene.markerCount,r.evidence.length)});

test("scene markers contain no baked-in extras",async()=>{const r=await offlineAgent(AutopsyAgent,cases.CLEANCORE).run();assert.equal(r.scene.markerCount,r.evidence.length);assert.ok(r.scene.markers.every(m=>m.id))});

test("scene mapping uses meaningful anchors",()=>{const markers=mapEvidenceToScene([{id:"E1",type:"liquidity_exit",title:"x",details:"x"},{id:"E2",type:"sell_sequence",title:"x",details:"x"}]);assert.equal(markers[0].scene.anchorId,"fridge_liquidity");assert.equal(markers[1].scene.anchorId,"knife_selling")});

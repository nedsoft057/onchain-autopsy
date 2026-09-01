/*
  Gemini-backed planner.

  Gemini is allowed to choose the next investigation action, but it is NOT
  trusted with blockchain facts or tool execution. The Action Guard in
  agent.js validates every proposed action before execution.

  The planner uses Google's Interactions API, which is the current recommended
  Gemini API interface for new agentic applications.
*/

const ALLOWED=new Set([
  "inspect_token",
  "inspect_liquidity",
  "inspect_holders",
  "inspect_wallet_cluster",
  "inspect_sell_sequence",
  "inspect_actor_behavior",
  "finish"
]);

const DEFAULT_MODEL="gemini-3.6-flash";
const DEFAULT_BASE_URL="https://generativelanguage.googleapis.com/v1beta/interactions";

function extractJson(text){
  const trimmed=String(text||"").trim();
  try{return JSON.parse(trimmed)}catch{}
  const fenced=trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if(fenced){try{return JSON.parse(fenced[1])}catch{}}
  const match=trimmed.match(/\{[\s\S]*\}/);
  if(!match)return null;
  try{return JSON.parse(match[0])}catch{return null}
}

function validate(value){
  if(!value||typeof value!=="object")return null;
  if(!ALLOWED.has(value.action))return null;
  if(typeof value.reason!=="string"||!value.reason.trim())return null;
  if(typeof value.question!=="string"||!value.question.trim())return null;
  return {
    action:value.action,
    reason:value.reason.trim(),
    question:value.question.trim(),
    source:"llm"
  };
}

function getText(body){
  const parts=[];
  for(const step of body?.steps||[]){
    if(step?.type!=="model_output")continue;
    for(const item of step?.content||[]){
      if(item?.type==="text"&&typeof item.text==="string")parts.push(item.text);
    }
  }
  return parts.join("\n").trim();
}

export class LLMPlanner{
  constructor({
    apiKey=process.env.GEMINI_API_KEY||process.env.AI_API_KEY,
    model=process.env.GEMINI_MODEL||process.env.AI_MODEL||DEFAULT_MODEL,
    baseUrl=process.env.GEMINI_BASE_URL||process.env.AI_BASE_URL||DEFAULT_BASE_URL,
    timeoutMs=Number(process.env.GEMINI_TIMEOUT_MS||process.env.AI_TIMEOUT_MS||15000)
  }={}){
    this.apiKey=apiKey;
    this.model=model;
    this.baseUrl=baseUrl;
    this.timeoutMs=timeoutMs;
  }

  get enabled(){
    return Boolean(this.apiKey&&this.model&&this.baseUrl);
  }

  async next(state){
    if(!this.enabled)return null;

    const system=`You are the planning layer of an on-chain investigation agent.
Your job is to choose exactly ONE next investigation action from this list:
inspect_token, inspect_liquidity, inspect_holders, inspect_wallet_cluster, inspect_sell_sequence, inspect_actor_behavior, finish.

Rules:
- Use ONLY observations already supplied in the input.
- Never invent blockchain facts, wallet counts, balances, prices, transactions, or evidence.
- Do not choose an investigation that has already been completed unless the current observations justify a re-check.
- Wallet-cluster investigation requires meaningful holder concentration evidence.
- Sell-sequence investigation requires a strong wallet relationship.
- A liquidity re-check is justified after coordinated selling when the initial liquidity has already been observed.
- Actor-behaviour investigation is required when holder data exposes sellers, shared funding, or deployer-linked wallets.
- Treat deployer transfers as a caution until the recipient wallets' acquisition path and subsequent behaviour support a stronger conclusion. They may be airdrops, allocations, or wallet distribution.
- Treat early-holder selling as a caution until timing, size, funding relationships, and coordination make a coordinated exit more plausible than ordinary profit-taking.
- Do not call a token a rug merely because it fell, holders sold, or the deployer transferred tokens.
- Finish only when the major investigation questions have been answered.
- Return ONLY a JSON object with exactly these fields: action, reason, question.`;

    const input=JSON.stringify({
      token:state.token,
      observations:state.observations,
      previousActions:state.toolHistory,
      evidence:state.evidence
    });

    const schema={
      type:"object",
      properties:{
        action:{type:"string",enum:[...ALLOWED]},
        reason:{type:"string"},
        question:{type:"string"}
      },
      required:["action","reason","question"]
    };

    const payload={
      model:this.model,
      system_instruction:system,
      input,
      response_format:{
        type:"text",
        mime_type:"application/json",
        schema
      },
    };

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),this.timeoutMs);

    try{
      const response=await fetch(this.baseUrl,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-goog-api-key":this.apiKey
        },
        body:JSON.stringify(payload),
        signal:controller.signal
      });

      if(!response.ok)return null;
      const body=await response.json();
      const text=getText(body);
      return validate(extractJson(text));
    }catch{
      return null;
    }finally{
      clearTimeout(timer);
    }
  }
}

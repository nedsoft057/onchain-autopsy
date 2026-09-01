const ALLOWED=new Set(["inspect_token","inspect_liquidity","inspect_holders","inspect_wallet_cluster","inspect_sell_sequence","inspect_actor_behavior","finish"]);
const DEFAULT_MODEL="openai/gpt-oss-20b";
const DEFAULT_BASE_URL="https://api.groq.com/openai/v1/chat/completions";
function validate(v){
 if(!v||typeof v!=="object"||!ALLOWED.has(v.action)||typeof v.reason!=="string"||typeof v.question!=="string")return null;
 return {action:v.action,reason:v.reason.trim(),question:v.question.trim(),source:"groq"};
}
export class GroqPlanner{
 constructor({apiKey=process.env.GROQ_API_KEY,model=process.env.GROQ_MODEL||DEFAULT_MODEL,baseUrl=process.env.GROQ_BASE_URL||DEFAULT_BASE_URL,timeoutMs=Number(process.env.GROQ_TIMEOUT_MS||8000)}={}){this.apiKey=apiKey;this.model=model;this.baseUrl=baseUrl;this.timeoutMs=timeoutMs}
 get enabled(){return Boolean(this.apiKey&&this.model&&this.baseUrl)}
 async next(state){
  if(!this.enabled)return null;
  const system=`You are the fallback planning layer of an on-chain investigation agent. Choose exactly ONE next action from: inspect_token, inspect_liquidity, inspect_holders, inspect_wallet_cluster, inspect_sell_sequence, inspect_actor_behavior, finish. Use only supplied observations. Never invent blockchain facts or evidence. Respect dependencies: wallet cluster requires meaningful holder concentration; sell sequence requires a strong wallet relationship; liquidity re-check follows coordinated selling after initial liquidity. Finish only when major questions are answered. Return only the requested JSON.`;
  const input=JSON.stringify({token:state.token,observations:state.observations,previousActions:state.toolHistory,evidence:state.evidence});
  const schema={type:"object",properties:{action:{type:"string",enum:[...ALLOWED]},reason:{type:"string"},question:{type:"string"}},required:["action","reason","question"],additionalProperties:false};
  const payload={model:this.model,messages:[{role:"system",content:system},{role:"user",content:input}],response_format:{type:"json_schema",json_schema:{name:"investigation_decision",strict:true,schema}}};
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  try{const r=await fetch(this.baseUrl,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.apiKey}`},body:JSON.stringify(payload),signal:controller.signal});if(!r.ok)return null;const b=await r.json();const text=b?.choices?.[0]?.message?.content;return validate(JSON.parse(text||"{}"))}catch{return null}finally{clearTimeout(timer)}
 }
}

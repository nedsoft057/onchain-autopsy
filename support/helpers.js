import{LLMPlanner}from"../src/llm/llmPlanner.js";
import{GroqPlanner}from"../src/llm/groqPlanner.js";

// Explicitly offline: tests must never inherit real LLM credentials from the shell.
export function offlineAgent(AutopsyAgent,caseData){
  return new AutopsyAgent(caseData,{
    aiPlanner:new LLMPlanner({apiKey:"",model:"",baseUrl:""}),
    groqPlanner:new GroqPlanner({apiKey:"",model:"",baseUrl:""})
  });
}

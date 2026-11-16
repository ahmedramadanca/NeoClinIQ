/**
 * Mobile-only SI bridge. Its bearer token MUST be issued by the mobile project,
 * NOT by the website project.
 *
 * Server checks mobile identity + mobile purchase before it accesses private
 * website-hosted source index. Website accounts cannot authorize this endpoint.
 */
import type {ReferenceAnswer} from "./originalReferenceAssistant";
const BRIDGE_URL = "https://uxnqoglkqptnslsdowxn.supabase.co/functions/v1/mobile-original-reference-assistant";
const BRIDGE_API_KEY = "sb_publishable_v0uOpwZ-BBas2E7jyDkMXQ_TzNOHdAA";
type MobileSessionProvider = {
  auth:{getSession:()=>Promise<{
    data:{session:{access_token:string}|null},
    error:{message:string}|null
  }>}
};
export async function askMobileOriginalReferences(
  client:MobileSessionProvider, question:string, signal?:AbortSignal,
):Promise<ReferenceAnswer>{
  const q=question.trim();
  if(q.length<8||q.length>3000)throw new Error("Please enter a question between 8 and 3000 characters.");
  const {data,error}=await client.auth.getSession();
  if(error||!data.session?.access_token)throw new Error("Sign in with your NeoClinIQ mobile account.");
  const response=await fetch(BRIDGE_URL,{
    method:"POST", signal, headers:{
      "Content-Type":"application/json", apikey:BRIDGE_API_KEY,
      Authorization:"Bearer "+data.session.access_token,
    },body:JSON.stringify({question:q})
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof payload.error==="string"?payload.error:"NeoClinIQ SI is temporarily unavailable.");
  return {
    answer:String(payload.answer||""),
    citations:Array.isArray(payload.citations)?payload.citations:[],
    insufficient_evidence:Boolean(payload.insufficient_evidence),
    notice:typeof payload.notice==="string"?payload.notice:undefined,
  };
}

import { createClient } from "npm:@supabase/supabase-js@2";

const site = Deno.env.get("WEBSITE_ALLOWED_ORIGIN") || "https://neocliniq.maplecanadaramadan.ca";
const url = Deno.env.get("SUPABASE_URL") || "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const headers = {
  "Access-Control-Allow-Origin": site,
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Cache-Control":"private, no-store",
  "Content-Type":"application/json",
  "Vary":"Origin",
  "X-Content-Type-Options":"nosniff",
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validActions=new Set(["status","start","save","submit","results"]);
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const knownResultStatuses=new Set([200,400,403,404,409,503]);
const maxBytes=65536;
async function readBody(req:Request) {
  if(!req.body) throw Error("Invalid request.");
  const reader=req.body.getReader();
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let bytes=0, json="";
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes){await reader.cancel();throw Error("Request is too large.");}
      json+=decoder.decode(value,{stream:true});
    }
    json+=decoder.decode();
  }finally{reader.releaseLock();}
  return JSON.parse(json);
}

Deno.serve(async (req:Request)=>{
  const origin=req.headers.get("origin");
  if(origin && origin!==site) return reply({error:"Origin not allowed."},403);
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers});
  if(req.method!=="POST") return reply({error:"Method not allowed."},405);
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type")||"")) return reply({error:"JSON request required."},415);
  const token=req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if(!token)return reply({error:"Sign in is required."},401);
  if(!url || !anon || !serviceRole)return reply({error:"Mock examination service is unavailable."},503);

  try {
    const auth=createClient(url,anon,clientOptions);
    const {data:{user},error:authError}=await auth.auth.getUser(token);
    if(authError || !user) return reply({error:"Sign in is required."},401);
    let body;
    try { body=await readBody(req); } catch {
      return reply({error:"Invalid or oversized request."},400);
    }
    if(!body || typeof body!=="object" || Array.isArray(body) || !validActions.has(body.action))
      return reply({error:"Invalid mock examination action."},400);
    const id=body.attempt_id;
    if(id!=null && (typeof id!=="string" || !uuid.test(id))) return reply({error:"Invalid attempt identifier."},400);
    if(["save","submit"].includes(body.action) && (!Array.isArray(body.answers)||!Array.isArray(body.flags)))
      return reply({error:"A complete answers and flags snapshot is required."},400);
    const db=createClient(url,serviceRole,clientOptions);
    const {data,error}=await db.rpc("website_mcq_mock_action",{
      p_user_id:user.id,p_action:body.action,p_attempt_id:id??null,
      p_answers:body.answers??[],p_flags:body.flags??[],p_compact:body.compact===true,
    });
    if(error || !data?.body || !knownResultStatuses.has(data.status))
      return reply({error:"Mock examination service is unavailable."},503);
    return reply(data.body,data.status);
  } catch {
    return reply({error:"Mock examination service is unavailable."},503);
  }
});

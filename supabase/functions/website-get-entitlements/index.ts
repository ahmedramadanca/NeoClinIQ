// Deploy as Supabase Edge Function: website-get-entitlements
// Requires Supabase-managed SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Never deploy the service-role key to GitHub Pages or browser code.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ORIGIN = "https://neocliniq.maplecanadaramadan.ca";
const cors = {
 "Access-Control-Allow-Origin": ORIGIN,
 "Access-Control-Allow-Methods": "GET, OPTIONS",
 "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
 "Vary": "Origin",
 "Cache-Control": "no-store"
};
function reply(body:unknown,status=200){
 return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="GET")return reply({error:"Method not allowed"},405);
 const origin=req.headers.get("origin");
 if(origin&&origin!==ORIGIN)return reply({error:"Origin not allowed"},403);
 const auth=req.headers.get("authorization")||"";
 const match=/^Bearer\s+(.+)$/i.exec(auth);
 if(!match)return reply({error:"Authentication required"},401);
 const url=Deno.env.get("SUPABASE_URL");
 const publicKey=Deno.env.get("SUPABASE_ANON_KEY");
 const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!publicKey||!serviceKey)return reply({error:"Service configuration incomplete"},503);
 try{
  // Authenticate with Supabase Auth; never trust user IDs supplied by the caller.
  const authClient=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await authClient.auth.getUser(match[1]);
  if(authError||!user)return reply({error:"Invalid or expired session"},401);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await admin.from("program_entitlements")
   .select("program,active,expires_at,extension_used")
   .eq("user_id",user.id).in("program",["mcq","osce"]);
  if(error){console.error("Entitlement query failed",error.code);return reply({error:"Entitlement lookup unavailable"},503)}
  const result:{mcq:unknown;osce:unknown}={mcq:null,osce:null};
  for(const record of data||[]){
   if(record.program==="mcq"||record.program==="osce"){
    result[record.program]={active:record.active===true,expires_at:record.expires_at,extension_used:record.extension_used===true};
   }
  }
  return reply(result);
 }catch(e){console.error("Entitlement function error",e instanceof Error?e.message:"unknown");return reply({error:"Service unavailable"},503)}
});

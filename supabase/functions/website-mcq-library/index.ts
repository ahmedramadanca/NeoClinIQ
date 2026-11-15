// Supabase Edge Function: website-mcq-library
// Deploy separately after creating private bucket "mcq-content" and table
// "mcq_resources" (see docs/mcq-content-setup.sql).
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// This function never trusts a browser-supplied subscription flag.
import { createClient } from "npm:@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")??"";
const ANON=Deno.env.get("SUPABASE_ANON_KEY")??"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ORIGIN="https://neocliniq.maplecanadaramadan.ca";
const headers={"Content-Type":"application/json","Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 if(req.headers.get("origin")!==ORIGIN)return json({error:"Origin not allowed"},403);
 if(!URL||!ANON||!SERVICE)return json({error:"Service not configured"},503);
 const auth=req.headers.get("authorization")??"";
 if(!auth.startsWith("Bearer "))return json({error:"Authentication required"},401);
 const jwt=auth.slice(7);
 const publicClient=createClient(URL,ANON,{auth:{persistSession:false}});
 const {data:{user},error:userError}=await publicClient.auth.getUser(jwt);
 if(userError||!user)return json({error:"Invalid session"},401);
 // Reuse the website's existing authoritative entitlement function.
 // A missing, malformed or expired entitlement always denies access.
 const entitlementResponse=await fetch(URL+"/functions/v1/website-get-entitlements",{headers:{Authorization:"Bearer "+jwt,apikey:ANON},cache:"no-store"}).catch(()=>null);
 if(!entitlementResponse?.ok)return json({error:"Unable to verify MCQ access"},503);
 const entitlements=await entitlementResponse.json().catch(()=>null);
 const mcq=entitlements?.mcq;
 if(mcq?.active!==true||typeof mcq.expires_at!=="string"||!(Date.parse(mcq.expires_at)>Date.now()))return json({error:"Active MCQ subscription required"},403);
 const admin=createClient(URL,SERVICE,{auth:{persistSession:false}});
 let body:{action?:string;id?:string};
 try{body=await req.json()}catch{return json({error:"Invalid request"},400)}
 if(body.action==="list"){
  const {data,error}=await admin.from("mcq_resources").select("id,title,module,type").eq("published",true).order("module").order("title");
  if(error)return json({error:"Resource catalogue unavailable"},503);
  return json({resources:data??[]});
 }
 if(body.action==="open"){
  if(typeof body.id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.id))return json({error:"Invalid resource ID"},400);
  const {data,error}=await admin.from("mcq_resources").select("storage_path").eq("id",body.id).eq("published",true).single();
  if(error||!data?.storage_path)return json({error:"Resource not found"},404);
  const {data:signed,error:signError}=await admin.storage.from("mcq-content").createSignedUrl(data.storage_path,60);
  if(signError||!signed?.signedUrl)return json({error:"Resource unavailable"},503);
  return json({url:signed.signedUrl});
 }
 return json({error:"Unsupported action"},400);
});

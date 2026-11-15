// Supabase Edge Function: video-transcript
// Deploy with: supabase functions deploy video-transcript
// Set OPENAI_API_KEY with: supabase secrets set OPENAI_API_KEY=...
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"https://neocliniq.maplecanadaramadan.ca","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const jwt=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!jwt)return json({error:"Authentication required"},401);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),key=Deno.env.get("OPENAI_API_KEY");
  if(!url||!anon||!service||!key)return json({error:"Transcription service is not configured"},503);
  const auth=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+jwt}}});
  const {data:{user},error:authError}=await auth.auth.getUser(jwt);
  if(authError||!user)return json({error:"Invalid session"},401);
  const {assetId}=await req.json();
  if(typeof assetId!=="string"||assetId.length>150)return json({error:"Invalid asset"},400);
  const admin=createClient(url,service);
  const {data:entitlement,error:entError}=await admin.from("program_entitlements").select("active,expires_at").eq("user_id",user.id).eq("program","mcq").eq("active",true).maybeSingle();
  if(entError||!entitlement||entitlement.expires_at&&new Date(entitlement.expires_at).getTime()<=Date.now())return json({error:"MCQ access required"},403);
  // Reuse the existing access function to validate ownership and issue a short-lived signed media URL.
  const access=await fetch(url+"/functions/v1/learning-access",{method:"POST",headers:{"Authorization":"Bearer "+jwt,"apikey":anon,"Content-Type":"application/json"},body:JSON.stringify({action:"get_media_url",assetId,program:"mcq"})});
  if(!access.ok)return json({error:"Media access denied"},403);
  const media=await access.json();
  const source=media.url;
  if(typeof source!=="string"||!source.startsWith("https://"))return json({error:"No video URL"},404);
  // Only fetch trusted Google Drive / Supabase storage URLs. Never accept arbitrary client URLs.
  const parsed=new URL(source);
  const trusted=parsed.hostname===new URL(url).hostname && parsed.pathname==="/functions/v1/learning-access" && parsed.searchParams.get("action")==="stream" && parsed.searchParams.get("assetId")===assetId && parsed.searchParams.get("scope")==="mcq";
  if(!trusted)return json({error:"Unsupported media host"},422);
  const mediaResponse=await fetch(source,{redirect:"error"});
  if(!mediaResponse.ok)return json({error:"Media download failed"},502);
  const length=Number(mediaResponse.headers.get("content-length")||0);
  if(length>24*1024*1024)return json({error:"Video exceeds transcription upload limit; extract/compress audio first"},413);
  if(!mediaResponse.body)return json({error:"Empty media stream"},502);const reader=mediaResponse.body.getReader();const parts:Uint8Array[]=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>24*1024*1024){await reader.cancel();return json({error:"Video exceeds transcription upload limit; extract/compress audio first"},413)}parts.push(value)}const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
  if(bytes.byteLength>24*1024*1024)return json({error:"Video exceeds transcription upload limit; extract/compress audio first"},413);
  const form=new FormData();
  form.append("file",new File([bytes],"lesson.mp4",{type:mediaResponse.headers.get("content-type")||"video/mp4"}));
  form.append("model","whisper-1");
  form.append("response_format","verbose_json");
  form.append("timestamp_granularities[]","segment");
  const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{"Authorization":"Bearer "+key},body:form});
  if(!response.ok)return json({error:"Transcription provider failed",details:(await response.text()).slice(0,250)},502);
  const result=await response.json();
  const segments=(result.segments||[]).map((s:{start:number,end:number,text:string})=>({start:s.start,end:s.end,text:s.text}));
  return json({transcript_segments:segments,transcript_text:result.text||"",source:"generated"});
 }catch(e){return json({error:"Transcription failed",details:String(e).slice(0,180)},500)}
});
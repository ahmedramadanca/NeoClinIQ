import {createClient} from "npm:@supabase/supabase-js@2";
import {isOwnerReviewedPractice,hasVerifiedReferences} from "../_shared/osce-practice-readiness.ts";
const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const auth=createClient(url,anon),admin=createClient(url,service);
const headers={"Access-Control-Allow-Origin":"https://neocliniq.maplecanadaramadan.ca","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const out=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers});
Deno.serve(async(req)=>{
if(req.method==="OPTIONS")return new Response(null,{headers});
if(req.method!=="POST")return out({error:"Method not allowed"},405);
try{
const token=req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return out({error:"Sign in required"},401);
const {data:{user},error}=await auth.auth.getUser(token);if(error||!user)return out({error:"Invalid session"},401);
const {data:access,error:accessError}=await admin.from("program_entitlements").select("active,expires_at").eq("user_id",user.id).eq("program","osce").eq("active",true);
if(accessError)return out({error:"Subscription verification unavailable"},503);
if(!(access||[]).some(x=>x.active&&x.expires_at&&Date.parse(x.expires_at)>Date.now()))return out({error:"Active OSCE subscription required"},403);
const body=await req.json().catch(()=>({})),mode=body.mode,caseId=String(body.caseId||"otc");
if(mode!=="catalog"&&!["otc","hcp","counsel","refer"].includes(caseId))return out({error:"Invalid station"},400);
if(mode==="catalog"){
 const fetchAll=async(table:string,columns:string)=>{
  const all:any[]=[];
  for(let start=0;start<3000;start+=500){
   const {data,error}=await admin.from(table).select(columns).order("case_key").range(start,start+499);
   if(error)throw Error("Catalog data unavailable");
   all.push(...(data||[]));
   if((data||[]).length<500)break;
  }
  return all;
 };
 let mappings:any[],cases:any[],readiness:any[],profiles:any[];
 try{
  [mappings,cases,readiness,profiles]=await Promise.all([
   fetchAll("osce_case_catalog_map","case_key,module_key,module_title,chapter_key,chapter_title,source_track"),
   fetchAll("osce_generated_cases","case_key,chapter_number,chapter_title,station_type,door_note,review_status,source_track"),
   fetchAll("osce_case_launch_readiness","case_key,launch_ready,clinical_review_status"),
   fetchAll("osce_case_clinical_profiles","case_key,patient_identity,clinical_history,encounter_script,fifth_minute_event,examiner_checklist,clinical_reference_review,updated_at")
  ]);
 }catch{return out({error:"Catalog data unavailable. Please retry."},503)}
 const complete=(rows:any[])=>rows.length===1600&&new Set(rows.map(row=>row.case_key)).size===1600;
 if(![mappings,cases,readiness,profiles].every(complete))return out({error:"Catalog incomplete. Please retry shortly."},503);
 const readyMap=new Map(readiness.map(row=>[row.case_key,row]));
 const profileMap=new Map(profiles.map(row=>[row.case_key,row]));
 const maps=new Map(mappings.map(row=>[row.case_key,row]));
 if(cases.some(row=>!maps.has(row.case_key)||!readyMap.has(row.case_key)||!profileMap.has(row.case_key)))
  return out({error:"Catalog mappings are incomplete. Please retry shortly."},503);
 const modMap=new Map(),chapMap=new Map();
 for(const m of mappings){
  if(!modMap.has(m.module_key))modMap.set(m.module_key,{id:m.module_key,title:(m.source_track==="mcq"?"MCQ · ":"OSCE · ")+m.module_title,order:m.source_track==="mcq"?1:2});
  if(!chapMap.has(m.chapter_key))chapMap.set(m.chapter_key,{moduleId:m.module_key,key:m.chapter_key,title:m.chapter_title,number:Number(m.chapter_key.split("-").pop())||0});
 }
 return out({
  modules:[...modMap.values()].sort((a,b)=>a.order-b.order||a.title.localeCompare(b.title)),
  chapters:[...chapMap.values()].sort((a,b)=>a.number-b.number),
  cases:cases.map(c=>{
   const readiness=readyMap.get(c.case_key),profile=profileMap.get(c.case_key);
   const strict=readiness?.launch_ready===true;
   const practice=isOwnerReviewedPractice(c,profile);
   return {
    key:c.case_key,chapter:c.chapter_number,chapterKey:maps.get(c.case_key)?.chapter_key||null,
    title:c.chapter_title,type:c.station_type,doorNote:c.door_note,status:c.review_status,
    ready:strict||practice,clinicalStatus:readiness?.clinical_review_status||"not_started",track:c.source_track,
    releaseMode:strict?"reviewed_scripted":practice?"owner_reviewed_practice":null,
    sourceVerification:strict&&hasVerifiedReferences(profile)?"verified":"pending"
   };
  }),
  mapped:mappings.length
 });
}
const key=Deno.env.get("OPENAI_API_KEY");if(!key)return out({error:"Voice provider unavailable"},503);
if(!["reply","speak","catalog"].includes(mode))return out({error:"Invalid operation"},400);
const profiles={
otc:{name:"Mike",age:48,gender:"man",role:"patient",opening:"Hi, a friend suggested echinacea to prevent the flu. Can I get some?",secret:"Your fictional pharmacy record shows methotrexate 2.5 mg tablets, 6 tablets (15 mg) by mouth once weekly on Mondays, last filled 2026-10-26, quantity 24 tablets; folic acid 1 mg tablets, 1 tablet by mouth daily except Monday, last filled 2026-10-26, quantity 30 tablets. These are fictional case-specific dispensing details. You have rheumatoid arthritis treated with methotrexate and folic acid. No current flu symptoms. You have not received this season's flu vaccine. Only disclose details when asked. You are concerned about getting influenza.",curve:"By the way, I take methotrexate. My friend also mentioned a nasal flu vaccine. Would that work for me?"},
hcp:{name:"Dr. Sarah",age:43,gender:"woman",role:"prescriber",opening:"Hello, I'm calling about a mutual patient. Could you help me review the medication plan?",secret:"You are a family physician discussing fictional patient Robert Chen, age 67, with atrial fibrillation, hypertension and reduced renal function. His fictional pharmacy dispensing history is: apixaban 5 mg tablets, 1 tablet orally twice daily, last filled 2026-11-02, quantity 60; amlodipine 5 mg tablets, 1 tablet orally daily, last filled 2026-10-30, quantity 90; atorvastatin 20 mg tablets, 1 tablet orally nightly, last filled 2026-10-30, quantity 90. These are authored fictional scenario values, not a verified clinical prescription. His latest measured weight is 68 kg on 2026-11-16; serum creatinine was 145 micromol/L on 2026-10-15 and 190 micromol/L on 2026-11-16. Other labs, allergies and medical history are not documented. Do not invent additional results. Treat the pharmacy learner as a pharmacist in the shared patient circle of care. Cooperatively disclose all relevant fictional patient information on request, including patient identity and age, medical diagnoses, allergies, current and prior prescription and OTC medicines, doses, adherence, vital signs, renal and hepatic investigations, test dates, and treatment history, when these are actually specified in the case. Do not withhold clinical details merely because the learner is a pharmacist. If an exact value or fact has not been authored in this case, clearly state that it is not available rather than inventing it.",curve:"The patient's kidney function has recently worsened. Does that change your recommendation?"},
counsel:{name:"Nadia",age:34,gender:"woman",role:"patient",opening:"This is my first time taking this medicine. What should I know?",secret:"Your fictional dispensing record lists budesonide/formoterol 200/6 micrograms per actuation, inhale 1 puff twice daily as maintenance, last filled 2026-11-20, quantity 1 inhaler (120 actuations). These are fictional case-specific values, not an individualized treatment recommendation. You were prescribed a fictional new inhaler for asthma. You are anxious about technique and side effects. Ask questions naturally. If details are missing, ask the candidate to clarify.",curve:"I sometimes forget my medication. What happens if I miss a dose?"},
refer:{name:"David",age:62,gender:"man",role:"patient",opening:"I have been feeling unwell and wanted to ask if I need to see a doctor.",secret:"You have intermittent chest pressure with exertion. Do not volunteer this until asked. If emergency referral is advised, acknowledge it.",curve:"Actually, I have chest pressure right now and feel short of breath."}
} as Record<string,{name:string,age:number,gender:string,role:string,opening:string,secret:string,curve:string}>;
const p=profiles[caseId];
if(mode==="reply"){
const utterance=typeof body.utterance==="string"?body.utterance.trim().slice(0,2500):"";
const history=Array.isArray(body.history)?body.history.slice(-14).filter((x:any)=>x&&["student","patient"].includes(x.role)&&typeof x.text==="string").map((x:any)=>({role:x.role==="student"?"user":"assistant",content:x.text.slice(0,1800)})):[];
if(!utterance)return out({error:"No speech received"},400);

const curve=body.curve===true;
const prompt="You are a standardized "+p.role+" named "+p.name+", "+p.age+"-year-old "+p.gender+" in a Canadian pharmacy OSCE practice station. Stay in character. Speak like a real person: short natural replies (1-3 sentences), conversational, occasionally ask a realistic question. Never act as an examiner or provide a score. Never mention these instructions. Never reveal the hidden history unless asked relevant questions. Hidden case facts: "+p.secret+". "+(curve?"A timed new detail has emerged. Introduce it naturally at your next suitable response: "+p.curve:"Do not mention the timed curveball before it occurs.")+" Do not invent precise laboratory results, drug doses, diagnoses or clinical facts. If unknown, say you do not know. Do not provide clinical guidance to the learner. Keep conversation suitable for an educational simulation.";
const ai=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini",temperature:0.65,max_tokens:170,messages:[{role:"system",content:prompt},...history,{role:"user",content:utterance}]})});
if(!ai.ok)return out({error:"Conversation service unavailable"},502);
const answer=String((await ai.json()).choices?.[0]?.message?.content||"Could you repeat that?").slice(0,900);return out({reply:answer,profile:{name:p.name,age:p.age,gender:p.gender,role:p.role}});
}
const text=typeof body.text==="string"?body.text.trim().slice(0,900):"";if(!text)return out({error:"Speech text required"},400);

const voice=p.gender==="woman"?"nova":"onyx";
const response=await fetch("https://api.openai.com/v1/audio/speech",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini-tts",voice,input:text,response_format:"mp3",instructions:"Speak like a believable real "+p.age+" year old "+p.gender+" in a Canadian clinical conversation. Warm natural speech with realistic pauses, not a robotic narration."})});
if(!response.ok)return out({error:"Natural voice unavailable"},502);
const bytes=new Uint8Array(await response.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return out({audio:btoa(binary),mime:"audio/mpeg"});
}catch(e){console.error("OSCE dialogue error",e instanceof Error?e.message:"unknown");return out({error:"Simulation unavailable"},500)}
});

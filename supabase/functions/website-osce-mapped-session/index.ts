import { createClient } from "npm:@supabase/supabase-js@2";

const AUTH_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const auth = createClient(AUTH_URL, (Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY"))!);
const db = createClient(AUTH_URL, SERVICE_KEY);
const headers = {
  "Access-Control-Allow-Origin":"https://neocliniq.maplecanadaramadan.ca",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers});
const cap = (x: unknown, limit = 1200) => typeof x === "string" ? x.trim().slice(0,limit) : "";
const ageOf = (time: string) => Date.now() - Date.parse(time);
const legacyFreeId = /^NC-OSCE-(?:SRC-)?[0-9]{3}-[0-9]{1,2}$/;
const validActions = new Set(["describe","start","enter","reply","curve","assess","end"]);
const checkInfo = async (table: string, cols: string, caseId: string) => {
  const {data,error} = await db.from(table).select(cols).eq("case_key",caseId).maybeSingle();
  if(error) throw Error("Unavailable case validation");
  return data as Record<string,any> | null;
};

async function approvedStation(caseId: string) {
  const [ready, queue, generated, profile] = await Promise.all([
    checkInfo("osce_case_launch_readiness","launch_ready,clinical_review_status",caseId),
    checkInfo("osce_case_authoring_queue","stage",caseId),
    checkInfo("osce_generated_cases","station_type,door_note",caseId),
    checkInfo("osce_case_clinical_profiles","patient_identity,encounter_script,fifth_minute_event,examiner_checklist,clinical_reference_review,clinical_review_status,reviewer,reviewed_at",caseId),
  ]);
  if(!ready?.launch_ready || ready.clinical_review_status !== "approved" ||
     queue?.stage !== "ready" || !generated || profile?.clinical_review_status !== "approved" ||
     !cap(profile.reviewer) || !profile.reviewed_at || !Number.isFinite(Date.parse(profile.reviewed_at))) return null;

  const door = cap(generated.door_note,3000);
  const name = cap(profile.patient_identity?.name,100);
  const age = Number(profile.patient_identity?.age);
  const gender = cap(profile.patient_identity?.gender,50);
  const opening = cap(profile.encounter_script?.opening,900);
  const normalize = (v: string) => v.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu," ").trim();
  const lines = profile.encounter_script?.approved_interactive_turns;
  const turns = Array.isArray(lines) ? lines.slice(0,80).map((line:any) => ({
    cues:(Array.isArray(line?.cues)?line.cues:[]).map((cue:any)=>normalize(cap(cue,100))).filter(Boolean).slice(0,12),
    reply:cap(line?.reply,900), afterCurve:line?.after_curve===true,
  })) : [];
  const fallback=cap(profile.encounter_script?.approved_fallback_reply,900);
  const curve = cap(profile.fifth_minute_event?.disclosure,900);
  const clockTrigger = cap(profile.fifth_minute_event?.trigger,300);
  const checklist = Array.isArray(profile.examiner_checklist) ? profile.examiner_checklist.map((item:any) => ({
      name:cap(item?.criterion,180), max:Number(item?.max)
  })) : [];
  const verifiedRefs = Array.isArray(profile.clinical_reference_review) ? profile.clinical_reference_review : [];
  const verified = verifiedRefs.length > 0 && verifiedRefs.every((ref:any) => {
    const locator=ref?.section ?? ref?.page ?? ref?.locator;
    return cap(ref?.title,250) &&
      ["verified","approved"].includes(cap(ref?.review_status,40).toLowerCase()) &&
      (cap(ref?.source_id,120) || cap(ref?.url,500)) &&
      (cap(locator,300) || (typeof locator === "number" && Number.isInteger(locator) && locator > 0));
  });
  if(!door || !name || !Number.isInteger(age) || age < 0 || age > 120 || !gender || !opening ||
     !turns.length || !fallback || turns.some((turn:any)=>!turn.cues.length||!turn.reply) ||
     !curve || !clockTrigger || !verified ||
     !checklist.length || checklist.some((x:any)=>!x.name||!Number.isInteger(x.max)||x.max<1) ||
     new Set(checklist.map((x:any)=>x.name)).size !== checklist.length ||
     checklist.reduce((n:number,item:any)=>n+item.max,0)!==15) return null;
  const role = generated.station_type === "prescriber_consultation" ? "prescriber" : "patient";
  function replyFor(utterance:string, afterCurve:boolean){
    const words=" "+normalize(utterance)+" ";
    let best=fallback, score=0;
    for(const turn of turns){
      if(turn.afterCurve&&!afterCurve)continue;
      const match=turn.cues.filter((cue:string)=>words.includes(" "+cue+" ")).reduce((n:number,cue:string)=>n+cue.length,0);
      if(match>score){score=match;best=turn.reply;}
    }
    return best;
  }
  // Do not expose private clinician notes, undisclosed turns or the future timed event.
  return {door,name,age,gender,role,opening,curve,checklist,replyFor};
}

Deno.serve(async (req:Request) => {
  if(req.method==="OPTIONS") return new Response(null,{headers});
  if(req.method!=="POST") return response({error:"Method not allowed"},405);
  try {
    const token=req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if(!token) return response({error:"Sign in required"},401);
    const {data:{user},error:authError}=await auth.auth.getUser(token);
    if(authError || !user) return response({error:"Sign in required"},401);
    const {data:entitlements,error:accessError}=await db.from("program_entitlements").select("expires_at")
      .eq("user_id",user.id).eq("program","osce").eq("active",true);
    if(accessError) return response({error:"Subscription verification unavailable"},503);
    if(!entitlements?.some((x:any)=>Number.isFinite(Date.parse(x.expires_at)) && ageOf(x.expires_at)<0))
      return response({error:"Active OSCE subscription required"},403);

    const body=await req.json().catch(()=>({}));
    const mode=body?.mode, caseId=body?.caseId;
    if(!validActions.has(mode) || typeof caseId!=="string" || !legacyFreeId.test(caseId))
      return response({error:"Invalid station operation"},400);

    const station=await approvedStation(caseId);
    if(!station) return response({error:"Case has not passed clinical, reference and playability review."},409);
    if(mode==="describe") return response({playable:true,caseId,doorNote:station.door});
    if(mode==="start") {
      const startedAt=new Date().toISOString();
      const {error}=await db.from("osce_reference_sessions")
        .upsert({user_id:user.id,case_id:caseId,started_at:startedAt,entered_at:null},{onConflict:"user_id"});
      if(error) return response({error:"Station setup unavailable"},503);
      return response({caseId,startedAt,doorNote:station.door});
    }
    const {data:session,error:sessionError}=await db.from("osce_reference_sessions").select("case_id,started_at,entered_at")
      .eq("user_id",user.id).maybeSingle();
    if(sessionError) return response({error:"Cannot confirm the station session"},503);
    if(!session || session.case_id!==caseId || !body.startedAt || Date.parse(body.startedAt)!==Date.parse(session.started_at) ||
       !Number.isFinite(ageOf(session.started_at)) || ageOf(session.started_at)>13*60*1000)
      return response({error:"Start this station again before continuing."},409);
    const sessionIdentity=()=>[user.id,caseId,session.started_at] as const;
    if(mode==="end") {
      const [userId,id,started]=sessionIdentity();
      const {error}=await db.from("osce_reference_sessions").delete().eq("user_id",userId).eq("case_id",id).eq("started_at",started);
      if(error) return response({error:"Could not close the station"},503);
      return response({ended:true});
    }
    if(mode==="enter") {
      if(!session.entered_at && ageOf(session.started_at)>5*60*1000) return response({error:"The door-note time expired. Restart the station."},409);
      let enteredAt=session.entered_at;
      if(!enteredAt) {
        const [userId,id,started]=sessionIdentity();
        const {data,error}=await db.from("osce_reference_sessions").update({entered_at:new Date().toISOString()})
          .eq("user_id",userId).eq("case_id",id).eq("started_at",started).is("entered_at",null).select("entered_at").maybeSingle();
        if(error || !data?.entered_at) return response({error:"Unable to enter this station. Try again."},409);
        enteredAt=data.entered_at;
      }
      if(ageOf(enteredAt)>7*60*1000) return response({error:"Station time expired."},409);
      return response({enteredAt,profile:{name:station.name,age:station.age,gender:station.gender,role:station.role},line:station.opening});
    }
    if(!session.entered_at || !Number.isFinite(ageOf(session.entered_at))) return response({error:"Enter the station first."},409);
    const elapsed=ageOf(session.entered_at);
    if(mode!=="assess" && elapsed>7*60*1000) return response({error:"Station time expired."},409);
    if(mode==="curve") {
      if(elapsed < 5*60*1000) return response({error:"The timed event is not yet available."},409);
      return response({line:station.curve});
    }
    if(mode==="reply") {
      const input=cap(body.utterance,2000);
      if(!input) return response({error:"Enter a candidate response first."},400);
      return response({reply:station.replyFor(input,elapsed>=5*60*1000)});
    }
    if(mode==="assess") {
      const [userId,id,started]=sessionIdentity();
      const {data:closed,error:closeError}=await db.from("osce_reference_sessions").delete().eq("user_id",userId).eq("case_id",id).eq("started_at",started).select("user_id").maybeSingle();
      if(closeError||!closed) return response({error:"The station session changed before assessment finished."},409);
      return response({selfAssessment:station.checklist,
        disclaimer:"Case-specific self-review. This is not an AI grade, clinical assessment or PEBC result."});
    }
    return response({error:"Invalid operation"},400);
  } catch(e) {
    console.error("Mapped OSCE request unavailable");
    return response({error:"Station service unavailable. Try again later."},503);
  }
});

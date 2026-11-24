import assert from "node:assert/strict";
import fs from "node:fs";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
const root=mkdtempSync(join(tmpdir(),"osce-mapped-test-"));
process.on("exit",()=>rmSync(root,{recursive:true,force:true}));
const helper=fs.readFileSync(new URL("../supabase/functions/_shared/osce-practice-readiness.ts",import.meta.url),"utf8").replace(/export /g,"");
const source=fs.readFileSync(new URL("../supabase/functions/website-osce-mapped-session/index.ts",import.meta.url),"utf8")
 .replace(/^import .+supabase-js.+;/m,"const createClient=globalThis.makeMock;")
 .replace(/^import .+osce-practice-readiness.+;\n/m,helper+"\n");
fs.writeFileSync(root+"/mock.mts",source);
const caseId="NC-OSCE-SRC-001-1", started=Date.now();
const profileVersion=new Date(started).toISOString();
let handler, session, entitled=true, queue="ready", approval="approved", refs=[{title:"Synthetic citation",source_id:"fixture",section:"§1",review_status:"verified"}], providerCalls=0;
let linkRows=[{title:"Current reference",locator:"Matching section",url:"https://www.canada.ca/example"}];
const rows={
 osce_case_launch_readiness:()=>({launch_ready:true,clinical_review_status:approval}),
 osce_case_authoring_queue:()=>({stage:queue}),
 osce_generated_cases:()=>({station_type:"prescriber_consultation",door_note:"Correct fixture door note"}),
 osce_case_clinical_profiles:()=>({updated_at:profileVersion,patient_identity:{name:"Fixture Fictional",age:19,gender:"woman"},encounter_script:{opening:"Fixture opening",hidden_facts:"NEVER_SERIALIZE_SECRET",approved_interactive_turns:[{cues:["fixture question"],reply:"Fixture reply"},{cues:["curve question"],reply:"Fixture timed reply",after_curve:true}],approved_fallback_reply:"Fixture fallback"},fifth_minute_event:{trigger:"300 seconds",disclosure:"Fixture curve"},examiner_checklist:[{criterion:"Fixture assessment",max:15}],clinical_reference_review:refs,clinical_review_status:approval,reviewer:"fixture-reviewer",reviewed_at:new Date().toISOString()}),
 program_entitlements:()=>[{expires_at:new Date(Date.now()+(entitled?60000:-60000)).toISOString()}],
 osce_reference_sessions:()=>session
};
globalThis.Deno={env:{get:()=> "fake-test-key-not-live"},serve:(cb)=>{handler=cb;}};
globalThis.makeMock=()=>({
 auth:{getUser:async (token)=>({data:{user:token==="test-token"?{id:"fixture-user"}:null},error:null})},
 from:(table)=>{
  let patch, remove=false, condition={}, op;const q={
   select:()=>q,eq:(k,v)=>{condition[k]=v;return q;},is:(k,v)=>q.eq(k,v),
   in:(k,v)=>{condition[k]=v;return q;},order:()=>q,limit:()=>q,
   maybeSingle:async()=>({data:await execute(),error:null}),
   upsert:async (x)=>{session=x;return {error:null}},
   update:(x)=>{patch=x;return q;},delete:()=>{remove=true;return q;},
   then:(resolve,reject)=>Promise.resolve(execute()).then(data=>resolve({data,error:null}),reject),
  };
  function execute(){
   if(table==="osce_station_reference_links"){
    assert.deepEqual(condition,{case_key:caseId,profile_version:profileVersion});
    return [...linkRows,{title:"Unsafe link",url:"javascript:void(0)"}];
   }
   if(table==="original_reference_documents"){
    assert.deepEqual(condition,{id:["fixture"]});return [{id:"fixture",title:"Indexed reference"}];
   }
   if(table==="original_reference_passages"){
    assert.deepEqual(condition,{document_id:"fixture",passage_number:[2]});
    return [{document_id:"fixture",passage_number:2,passage_text:"Reviewed passage"},
      {document_id:"fixture",passage_number:3,passage_text:"UNAUTHORIZED_NEIGHBOUR"}];
   }
   if(table==="osce_reference_sessions"&&(patch||remove)){
    if(!session||Object.entries(condition).some(([k,v])=>session[k]!==v))return null;
    if(patch)Object.assign(session,patch);if(remove){const result=session;session=null;return result;}
   }
   return rows[table]();
  }
  return q;
 }
});
globalThis.fetch=async (url,options)=>{
 if(url.endsWith("/audio/speech"))return new Response(new Uint8Array([0]));
 providerCalls++;
 assert.ok(url.endsWith("/chat/completions"));
 assert.ok(!options.body.includes("CLIENT_FORGED_HISTORY"));
 return Response.json({choices:[{message:{content:JSON.stringify({criteria:[{name:"Fixture assessment",earned:1}]})}}]});
};
await import(pathToFileURL(root+"/mock.mts").href);
async function run(mode,body={},token="test-token"){
 const r=await handler(new Request("https://example.invalid",{
  method:"POST",headers:{Authorization:"Bearer "+token},body:JSON.stringify({mode,caseId,...body}),
 }));
 return [r.status,await r.json()];
}
assert.equal((await run("describe",{},"invalid"))[0],401);
entitled=false; assert.equal((await run("describe"))[0],403); entitled=true;
assert.equal((await run("describe",{caseId:"otc"}))[0],400);
queue="qa_testing";assert.equal((await run("describe"))[0],409);queue="ready";
approval="in_progress";assert.equal((await run("start"))[0],409);approval="approved";
refs[0].review_status="not_reviewed";assert.equal((await run("start"))[0],409);refs[0].review_status="verified";
assert.equal(providerCalls,0);assert.equal(session,undefined);
const [readyCode,ready]=await run("describe");assert.equal(readyCode,200);assert.deepEqual(ready,{caseId,playable:true,doorNote:"Correct fixture door note"});
const [startCode,result]=await run("start");assert.equal(startCode,200);
const options={startedAt:result.startedAt};
assert.equal((await run("reply",{...options,utterance:"Fixture question"}))[0],409);
assert.equal((await run("references",options))[0],409);
const [enterCode,enter]=await run("enter",options);assert.equal(enterCode,200);assert.equal(enter.profile.name,"Fixture Fictional");assert.equal(enter.line,"Fixture opening");
assert.equal((await run("references",{...options,caseId:"NC-OSCE-SRC-001-2"}))[0],409);
assert.deepEqual((await run("references",options))[1].references,[{...linkRows[0],verification:"case_matched_public_source"}]);
linkRows=[];
refs[0].passage_number=2;
assert.deepEqual((await run("references",options))[1].references,[]);
refs[0].display_authorized=true;
assert.deepEqual((await run("references",options))[1].references,[{title:"Indexed reference",verification:"verified",excerpts:[{section:2,text:"Reviewed passage"}]}]);
assert.ok(!JSON.stringify(enter).includes("NEVER_SERIALIZE_SECRET"));assert.ok(!JSON.stringify(enter).includes("Fixture assessment"));
assert.equal((await run("curve",options))[0],409);
assert.equal((await run("speak",{...options,text:"Different content"}))[0],400);
assert.equal((await run("reply",{...options,utterance:"curve question"}))[1].reply,"Fixture fallback");
const [replyCode,reply]=await run("reply",{...options,utterance:"Fixture question"});assert.equal(replyCode,200);assert.equal(reply.reply,"Fixture reply");
session.entered_at=new Date(Date.now()-301000).toISOString();
assert.equal((await run("curve",options))[1].line,"Fixture curve");
assert.equal((await run("reply",{...options,utterance:"curve question"}))[1].reply,"Fixture timed reply");
approval="in_progress";assert.equal((await run("reply",{...options,utterance:"Fixture question"}))[0],409);approval="approved";
entitled=false;assert.equal((await run("curve",options))[0],403);entitled=true;
const [assessmentCode,assessment]=await run("assess",{...options,history:[{role:"student",text:"CLIENT_FORGED_HISTORY"}]});
assert.equal(assessmentCode,200);assert.equal(assessment.report.criteria[0].name,"Fixture assessment");assert.equal(assessment.report.max,15);assert.equal(providerCalls,1);
assert.equal(session,null);assert.equal((await run("curve",options))[0],409);
console.log("Passed mapped endpoint fixture: entitlement, case-specific links, exact authorized excerpts, timing, scripted turns, assessment and session invalidation.");


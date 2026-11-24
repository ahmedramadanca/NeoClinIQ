import assert from "node:assert/strict";
import fs from "node:fs";
import {mkdtempSync,rmSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import vm from "node:vm";

const root=mkdtempSync(join(tmpdir(),"osce-catalog-release-"));
process.on("exit",()=>rmSync(root,{recursive:true,force:true}));
mkdirSync(root+"/website-osce-dialogue",{recursive:true});
mkdirSync(root+"/_shared",{recursive:true});
const source=fs.readFileSync(new URL("../supabase/functions/website-osce-dialogue/index.ts",import.meta.url),"utf8")
 .replace(/^import \{createClient\}.+;/m,"const createClient=globalThis.makeMock;");
fs.writeFileSync(root+"/website-osce-dialogue/index.mts",source);
fs.copyFileSync(new URL("../supabase/functions/_shared/osce-practice-readiness.ts",import.meta.url),root+"/_shared/osce-practice-readiness.ts");

const now=Date.now(),contentTime=new Date(now-60000).toISOString(),approvalTime=new Date(now-30000).toISOString();
const types=["minor_ailment","otc_recommendation","natural_health_product","prescriber_consultation","new_rx_inquiry","physician_referral","rx_dispensing_counselling"];
const tables={osce_case_catalog_map:[],osce_generated_cases:[],osce_case_launch_readiness:[],osce_case_clinical_profiles:[]};
for(let i=0;i<1600;i++){
 const track=i<800?"mcq":"osce",offset=i%800,n=offset+1;
 const case_key=`NC-OSCE-${track==="osce"?"SRC-":""}${String(n).padStart(3,"0")}-1`;
 const module=(offset%(track==="mcq"?14:16))+1;
 tables.osce_case_catalog_map.push({case_key,module_key:`${track}-${module}`,module_title:`Module ${module}`,chapter_key:`${track}-${module}-${n}`,chapter_title:`Chapter ${n}`,source_track:track});
 tables.osce_generated_cases.push({case_key,chapter_number:n,chapter_title:`Chapter ${n}`,station_type:types[i%types.length],door_note:`Fictional instructions ${case_key}`,review_status:"published",source_track:track});
 tables.osce_case_launch_readiness.push({case_key,launch_ready:false,clinical_review_status:"in_progress"});
 tables.osce_case_clinical_profiles.push({case_key,patient_identity:{name:`Fictional participant ${n}`,age:40,gender:"woman"},
  clinical_history:{symptoms:"PRIVATE_CASE_FACT"},encounter_script:{opening:"Hello",hidden_facts:["PRIVATE_HIDDEN_FACT"],patient_roleplay_rules:["PRIVATE_ROLEPLAY_RULE"],medication_status:"No medicines authored",allergy_status:"Allergy status unknown",
   publication:{mode:"owner_reviewed_practice",active:true,authorized_by:"Ahmed Ramadan",authorized_at:approvalTime,content_updated_at:contentTime,source_verification:"pending",release_id:"osce-1600-20261124"}},
  fifth_minute_event:{trigger:"After five minutes",disclosure:"A fictional new concern"},examiner_checklist:[{criterion:"Fixture assessment",max:15}],
  clinical_reference_review:[{title:"Unverified reference lead",source_id:"fixture-reference",review_status:"not_reviewed"}],updated_at:contentTime});
}
let handler,access=true,providerCalls=0;
const ranges=[];
globalThis.Deno={env:{get:()=>"fixture-not-a-live-key"},serve:callback=>{handler=callback;}};
globalThis.makeMock=()=>({auth:{getUser:async token=>({data:{user:token==="fixture-token"?{id:"fixture-user"}:null},error:null})},
 from:table=>{
  const q={select:()=>q,eq:()=>q,order:()=>q,
   range:async(start,end)=>{ranges.push({table,start,end});return {data:tables[table].slice(start,end+1),error:null};},
   then:(resolve,reject)=>Promise.resolve({data:table==="program_entitlements"?[{active:true,expires_at:new Date(Date.now()+(access?60000:-60000)).toISOString()}]:tables[table],error:null}).then(resolve,reject)};
  return q;
 }});
globalThis.fetch=async()=>{providerCalls++;throw Error("Catalog must not call an AI provider");};
await import(pathToFileURL(root+"/website-osce-dialogue/index.mts").href);
async function request(token="fixture-token"){
 const response=await handler(new Request("https://example.invalid",{method:"POST",headers:{Authorization:"Bearer "+token},body:JSON.stringify({mode:"catalog"})}));
 return [response.status,await response.json()];
}
assert.equal((await request("invalid"))[0],401);
access=false;assert.equal((await request())[0],403);access=true;
assert.equal(ranges.length,0);
const [code,catalog]=await request();
assert.equal(code,200);assert.equal(catalog.mapped,1600);assert.equal(catalog.cases.length,1600);
assert.equal(new Set(catalog.cases.map(item=>item.key)).size,1600);
assert.equal(catalog.modules.filter(item=>item.id.startsWith("mcq-")).length,14);
assert.equal(catalog.modules.filter(item=>item.id.startsWith("osce-")).length,16);
for(const table of Object.keys(tables))assert.deepEqual(ranges.filter(x=>x.table===table).map(x=>x.start),[0,500,1000,1500]);
assert.ok(catalog.cases.every(item=>item.ready&&item.releaseMode==="owner_reviewed_practice"&&item.sourceVerification==="pending"&&item.clinicalStatus==="in_progress"));
assert.ok(!JSON.stringify(catalog).includes("PRIVATE_"));
assert.ok(!JSON.stringify(catalog).includes("authorized_by"));
const html=fs.readFileSync(new URL("../osce-simulator.html",import.meta.url),"utf8");
const classifier=html.match(/function osceExamCriterion\(c\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(classifier,"The deployed UI criterion classifier must exist");
const criterion=vm.runInNewContext(classifier+";osceExamCriterion");
const criteria=new Set(catalog.cases.map(criterion));
assert.equal(criteria.size,9);assert.ok(!criteria.has(""));

const first=tables.osce_case_clinical_profiles[0],publication=first.encounter_script.publication;
async function unavailable(change,restore){change();const [status,data]=await request();assert.equal(status,200);assert.equal(data.cases[0].ready,false);assert.equal(data.cases[0].releaseMode,null);restore();}
await unavailable(()=>publication.active=false,()=>publication.active=true);
await unavailable(()=>publication.authorized_by="",()=>publication.authorized_by="Ahmed Ramadan");
await unavailable(()=>publication.release_id="",()=>publication.release_id="osce-1600-20261124");
await unavailable(()=>publication.authorized_at="invalid",()=>publication.authorized_at=approvalTime);
await unavailable(()=>publication.authorized_at=new Date(now+3600000).toISOString(),()=>publication.authorized_at=approvalTime);
await unavailable(()=>publication.source_verification="verified",()=>publication.source_verification="pending");
await unavailable(()=>first.updated_at=new Date(now-1000).toISOString(),()=>first.updated_at=contentTime);
await unavailable(()=>tables.osce_generated_cases[0].review_status="draft",()=>tables.osce_generated_cases[0].review_status="published");
await unavailable(()=>first.encounter_script.patient_roleplay_rules=[],()=>first.encounter_script.patient_roleplay_rules=["PRIVATE_ROLEPLAY_RULE"]);
await unavailable(()=>first.patient_identity.age=null,()=>first.patient_identity.age=40);
await unavailable(()=>first.patient_identity.age="",()=>first.patient_identity.age=40);
await unavailable(()=>first.examiner_checklist[0].max=14,()=>first.examiner_checklist[0].max=15);
first.encounter_script.medication_status={current:"No medicines authored"};
first.encounter_script.allergy_status=["Allergy status unknown"];
assert.equal((await request())[1].cases[0].ready,true);
await unavailable(()=>first.encounter_script.medication_status={},()=>first.encounter_script.medication_status={current:"No medicines authored"});
await unavailable(()=>first.encounter_script.allergy_status=[],()=>first.encounter_script.allergy_status=["Allergy status unknown"]);

// Legacy strict readiness stays available independently of owner-practice publication.
publication.active=false;tables.osce_case_launch_readiness[0]={case_key:first.case_key,launch_ready:true,clinical_review_status:"approved"};
first.clinical_reference_review=[{title:"Fixture verified source",source_id:"fixture",section:"Fixture section",review_status:"verified"}];
const [,strict]=await request();assert.equal(strict.cases[0].ready,true);assert.equal(strict.cases[0].releaseMode,"reviewed_scripted");assert.equal(strict.cases[0].sourceVerification,"verified");
assert.equal(tables.osce_case_clinical_profiles[1].encounter_script.publication.source_verification,"pending");
assert.equal(tables.osce_case_launch_readiness[1].clinical_review_status,"in_progress");
const saved=tables.osce_case_catalog_map[1];tables.osce_case_catalog_map[1]=tables.osce_case_catalog_map[0];assert.equal((await request())[0],503);tables.osce_case_catalog_map[1]=saved;
const removed=tables.osce_case_clinical_profiles.pop();assert.equal((await request())[0],503);tables.osce_case_clinical_profiles.push(removed);
assert.equal(providerCalls,0);
console.log("Passed catalog release fixture: paid access, 1,600 unique paginated cases, 14+16 modules, nine criteria, private-data exclusion, invalid/stale metadata, publication revocation, pending clinical status, and strict legacy readiness.");

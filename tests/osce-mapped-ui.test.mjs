import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync(new URL("../osce-simulator.html",import.meta.url),"utf8");
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
.replace(/^import .+;/m,"").replace(/\nverify\(\);\s*$/,"");
const nodes=new Map();
function makeNode(){
 const n={disabled:false,textContent:"",value:"",options:[],children:[],style:{},attributes:{},classList:{add(){},remove(){},toggle(){}},
 setAttribute(k,v){this.attributes[k]=v},replaceChildren(){this.children=[];this.options=[];},append(...x){this.children.push(...x);this.options.push(...x)},pause(){},play:async()=>{}};
 return n;
}
const get=id=>{if(!nodes.has(id))nodes.set(id,makeNode());return nodes.get(id)};
const calls=[], DEFER=[];
const readyId="NC-OSCE-001-1", draftId="NC-OSCE-001-2";
const createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:"fake"}}})}});
const fetch=async (url,request)=>{
 const body=JSON.parse(request.body);calls.push([url,body]);
 if(body.mode==="describe")return new Promise(resolve=>DEFER.push(resolve));
 if(body.mode==="start")return Response.json({caseId:readyId,startedAt:"fixture",doorNote:"Mapped instructions"});
 if(body.mode==="enter")return Response.json({profile:{name:"Fixture Participant",age:19,gender:"other",role:"patient"},line:"Mapped opening",proof:"proof"});
 if(body.mode==="speak")return Response.json({audio:"AA=="}); 
 if(body.mode==="reply")return Response.json({reply:"Mapped reply",proof:"proof2"});
 if(body.mode==="assess")return Response.json({selfAssessment:[{name:"Fixture criterion",max:15}],disclaimer:"Fixture formative only"});
 throw Error("unexpected "+body.mode);
};
const document={getElementById:get,createElement:makeNode};
const context={document, window:{addEventListener(){}}, createClient, fetch, URL, Blob, atob, Uint8Array, setTimeout, clearTimeout,setInterval:()=>1,clearInterval:()=>{},performance};
vm.createContext(context);
vm.runInContext(source,context);
vm.runInContext(`osceCatalog={cases:[{key:"${readyId}",ready:true},{key:"${draftId}",ready:false}]}`,context);
get("osce-case").value=readyId;
const stale=get("osce-case").onchange();
await new Promise(setImmediate);
get("osce-case").value=draftId;await get("osce-case").onchange();
DEFER.shift()(Response.json({playable:true,caseId:readyId,doorNote:"stale instructions"}));await stale;
assert.equal(get("live-start").disabled,true);
assert.match(get("osce-case-notice").textContent,/draft/);
get("osce-case").value=readyId;const selecting=get("osce-case").onchange();await new Promise(setImmediate);
DEFER.shift()(Response.json({playable:true,caseId:readyId,doorNote:"Verified instructions",releaseMode:"owner_reviewed_practice",sourceVerification:"pending",practiceNotice:"AI roleplay practice. Source verification pending."}));await selecting;
assert.equal(get("live-start").disabled,false);assert.match(get("osce-case-door").textContent,/Practice station/);assert.match(get("osce-case-notice").textContent,/verification pending/);
await get("live-start").onclick();
assert.match(get("live-door").textContent,/Mapped instructions/);
assert.equal(get("live-mic-toggle").attributes["aria-pressed"],"false");assert.equal(get("live-mic-toggle").disabled,false);
assert.equal(get("osce-case").disabled,true);
await vm.runInContext("liveEncounter()",context);
assert.match(get("live-name").textContent,/Fixture Participant/);
await vm.runInContext('liveAnswer("Candidate statement")',context);
assert.equal(get("live-reply").textContent,"Mapped reply");
await vm.runInContext("liveFinish()",context);
assert.equal(get("osce-case").disabled,false);
assert.equal(get("live-status").textContent,"Fixture formative only");
assert.ok(calls.every(([route,b])=>route.endsWith("/website-osce-mapped-session")&&b.caseId===readyId));
assert.ok(calls.filter(([,b])=>["enter","reply","assess"].includes(b.mode)).every(([,b])=>b.startedAt==="fixture"));assert.ok(calls.every(([,b])=>!b.history));assert.ok(calls.every(([,b])=>b.mode!=="speak"));
assert.match(html,/processed by NeoClinIQ’s AI provider/);
assert.ok(!html.includes("Mapped stations never send your responses to an AI provider"));
assert.match(html,/id="legacy-station-selector" hidden/);
console.log("Passed simulator UI fixture: stale approval response cannot start a draft, mapped ID persisted, door→enter→dialogue→assessment, optional mapped microphone, local text fallback, legacy endpoint not used for mapped case.");


import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const html=read('../../mcq-mock.html'),src=read('../../mcq-mock.js').replace(/^import[^\n]+/,'const {createClient}=globalThis;');
const fixture=[...Array(200)].map((_,i)=>({id:'q'+(i+1),stem:'Fixture only '+(i+1),options:['a','b','c','d'].map(id=>({id,text:'Fixture '+id}))}));
assert(!html.includes(fixture[0].stem));assert(!src.includes(fixture[0].stem));
const events=[];let subscription=true,online=true,delay=false,clock=0,attempt=null,force409=false;
const iso=ms=>new Date(ms).toISOString();
function response(body){
  if(!attempt)return {state:'available',server_now:iso(clock)};
  const closed=attempt.closed||clock>=attempt.expires;
  const state=attempt.closed?'submitted':closed?'expired':'in_progress';
  const meta={state,server_now:iso(clock),expires_at:iso(attempt.expires),attempt_id:'fixture'};
  if(body.compact)return meta;
  if(!closed)return {...meta,questions:fixture,answers:attempt.answers,flags:attempt.flags};
  const selections=new Map(attempt.answers.map(x=>[x.question_id,x.choice_id]));
  const items=fixture.map(({id,stem,options})=>({question_id:id,stem,options,selected_choice_id:selections.get(id)??null,correct_choice_id:'a',is_correct:selections.get(id)==='a',correct_rationale:'Correct evidence',selected_rationale:'Wrong-choice explanation',source_titles:['<a href="https://example.org">A title, not a link</a>']}));
  const correct=items.filter(x=>x.is_correct).length,wrong=selections.size-correct;
  return {...meta,result:{correct,wrong,unanswered:200-selections.size,total:200,items}};
}
async function mockFetch(url,req){
  assert.match(url,/website-mcq-mock$/);assert.equal(req.headers.Authorization,'Bearer fixture-token');
  const body=JSON.parse(req.body);
  events.push(body);
  const res=(data,status=200)=>({ok:status===200,status,json:async()=>data});
  if(!online)throw Error('offline');
  if(!subscription)return res({},403);
  if(body.action==='results'&&force409){force409=false;return res({},409)}
  if(body.action==='start'&&!attempt)attempt={expires:clock+15600000,answers:[],flags:[]};
  if(body.action==='save'&&delay)await new Promise(resolve=>setTimeout(resolve,20));
  if(attempt&&!attempt.closed&&clock<attempt.expires&&['save','submit'].includes(body.action)){
    attempt.answers=body.answers;attempt.flags=body.flags;
    if(body.action==='submit')attempt.closed=true;
  }
  return res(response(body));
}
function mount({signedOut=false}={}){
  let focused;const timers=[],windowEvents={},documentEvents={};
  class Node {
    constructor(tag){this.tag=tag;this.own='';this.children=[];this.dataset={};this.events={};this.attrs={};this.classes=new Set();this.hidden=false;this.value='';this.classList={toggle:(k,v)=>v?this.classes.add(k):this.classes.delete(k)}}
    set textContent(s){this.own=s;this.children=[]}
    get textContent(){return this.own+this.children.map(c=>c.textContent).join('')}
    append(...nodes){for(const n of nodes)if(n.tag==='#fragment')this.append(...n.children);else this.children.push(n)}
    replaceChildren(...nodes){this.children=[];this.own='';this.append(...nodes)}
    setAttribute(k,v){this.attrs[k]=v}
    addEventListener(k,f){this.events[k]=f}
    focus(){focused=this.id}
    close(){this.open=false}
    showModal(){this.open=true}
    querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)])}
    querySelector(tag){return this.querySelectorAll(tag)[0]}
  }
  const ids={};
  for(const match of html.matchAll(/<(\w+) [^>]*\bid="([^"]+)"/g)){const [,tag,id]=match;ids[id]=Object.assign(new Node(tag),{id})}
  const doc={
    getElementById:id=>{assert(ids[id],id);return ids[id]},
    createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('#fragment'),
    addEventListener:(k,fn)=>documentEvents[k]=fn,
  };
  let authFn;
  const context=vm.createContext({
    console,queueMicrotask,AbortSignal,document:doc,window:{addEventListener:(k,v)=>windowEvents[k]=v},
    performance:{now:()=>clock},setInterval(fn){timers.push(fn);return timers.length},clearInterval(id){timers[id-1]=null},
    setTimeout(fn){return setTimeout(fn,0)},fetch:mockFetch,
    createClient:()=>({auth:{getSession:async()=>({data:{session:signedOut?null:{access_token:'fixture-token',user:{id:'fixture-user'}}}}),onAuthStateChange:f=>{authFn=f}}}),
  });
  const ready=vm.runInContext('(async()=>{'+src+'})()',context);
  return {ids,ready,click:id=>ids[id].events.click(),change:(id,target)=>ids[id].events.change({target}),focused:()=>focused,
    pulse(){for(const fn of timers)fn?.()},signOut(){authFn('SIGNED_OUT',null)},online(){windowEvents.online()}};
}
let m=mount({signedOut:true});await m.ready;
assert.equal(m.ids.blocked.hidden,false);assert.equal(events.length,0);
assert(!m.ids.stem.textContent);
subscription=false;m=mount();await m.ready;
assert.match(m.ids['blocked-text'].textContent,/active paid/);assert(!m.ids.stem.textContent);
subscription=true;m=mount();await m.ready;
assert.equal(m.ids.entry.hidden,false);assert.equal(attempt,null);
const settle=async(fn)=>{for(let i=0;i<30;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5))}throw Error('state did not settle')};
m.click('start');await settle(()=>!m.ids.active.hidden);
assert.equal(m.ids.options.querySelectorAll('input').length,4);
assert.equal(m.ids.jump.children.length,200);
assert.equal(m.ids.timer.textContent,'4:20:00');
assert.equal(m.focused(),'question-title');
delay=true;m.change('options',{value:'b'});m.click('flag');m.click('next');
m.change('options',{value:'a'});m.click('clear');m.click('next');m.change('options',{value:'a'});
await settle(()=>m.ids['save-status'].textContent==='Progress saved');
assert.deepEqual(attempt.answers,[{question_id:'q1',choice_id:'b'},{question_id:'q3',choice_id:'a'}]);
assert.deepEqual(attempt.flags,['q1']);
assert.equal(Object.values(m.ids).some(node=>node.textContent.includes('Correct evidence')),false);
delay=false;online=false;m.change('options',{value:'b'});
await settle(()=>!m.ids['retry-save'].hidden);
assert.match(m.ids['save-status'].textContent,/not saved/);
online=true;m.online();await settle(()=>m.ids['save-status'].textContent==='Progress saved');
assert.deepEqual(attempt.answers,[{question_id:'q1',choice_id:'b'},{question_id:'q3',choice_id:'b'}]);
const expiry=attempt.expires;clock+=9000;
m=mount();await m.ready;
assert.equal(attempt.expires,expiry);assert.equal(m.ids.timer.textContent,'4:19:51');
assert.match(m.ids['question-title'].textContent,/Question 2 of 200/);
m.ids.filter.value='flagged';m.change('filter');assert.equal(m.ids.jump.children.length,1);
m.ids.filter.value='unanswered';m.change('filter');assert.equal(m.ids.jump.children.length,198);
m.click('finish');assert.equal(m.ids.confirmation.open,true);m.click('cancel-submit');assert(!attempt.closed);
m.click('finish');m.click('confirm-submit');await settle(()=>!m.ids.results.hidden);
assert.equal(m.ids.score.textContent,'0 / 200 correct2 incorrect198 unanswered');
m.ids['result-filter'].value='wrong';m.change('result-filter');
assert.equal(m.ids.review.children.length,2);
assert.match(m.ids.review.children[0].textContent,/Correct evidence.*Wrong-choice explanation.*<a href=/);
assert.equal(m.ids.review.querySelectorAll('a').length,0);
assert.equal(m.ids.stem.textContent,'');
m=mount();await m.ready;assert.equal(m.ids.review.children.length,200);
m.signOut();assert.equal(m.ids.results.hidden,true);assert.equal(m.ids.review.children.length,0);
attempt={expires:clock+10000,answers:[{question_id:'q1',choice_id:'a'}],flags:[]};
m=mount();await m.ready;m.click('finish');assert(m.ids.confirmation.open);
force409=true;clock+=10000;m.pulse();
await settle(()=>!m.ids.results.hidden);
assert.match(m.ids.completion.textContent,/Time expired/);
assert(!m.ids.confirmation.open);
assert.deepEqual(events.slice(-2),Array.from({length:2},()=>({action:'results',attempt_id:'fixture'})));
assert.equal(m.ids.score.textContent,'1 / 200 correct0 incorrect199 unanswered');
const portal=read('../../learning.html');
assert.match(portal,/class="panel hidden" id="mcq-mock-card"/);
assert.match(portal,/action:"status",compact:true/);
assert.match(portal,/mockAttempt===mockCheck&&session\?\.user\?\.id===mockSession\.user\.id/);
console.log('PASS: 200×4; signed-out and non-subscriber denial; explicit timed start; serialized saves including clear/flag, offline retry; deadline reload; flagged/unanswered; cancel then submit; score and both rationales; text-only refs; result reload and sign-out erasure; deadline read-only retry after 409; hidden portal link with compact server gate.');

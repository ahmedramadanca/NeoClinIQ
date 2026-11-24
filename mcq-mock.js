import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const BASE='https://uxnqoglkqptnslsdowxn.supabase.co';
const KEY='sb_publishable_v0uOpwZ-BBas2E7jyDkMXQ_TzNOHdAA';
const client=createClient(BASE,KEY);
const count=200;
const $=id=>document.getElementById(id);
const states=['entry','active','results','blocked'];
const status=(text='')=>{$('notice').textContent=text};
const elapsed=()=>performance.now();
const el=(name,text,className)=>{
  const node=document.createElement(name);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
};
let session=null,epoch=0,loaded=false,view='',attempt=null,questions=[],idx=0,answers=new Map(),flags=new Set(),result=null;
let endAt=0,timer=null,revision=0,savedRevision=0,saveJob=null,saveFailed=false,ended=false,closing=false,cachedSeconds=-1;
let verificationPending=false;

function show(which,focus){
  states.forEach(x=>{$(x).hidden=x!==which});
  view=which;
  if(focus)$(focus).focus();
}
function retire(){
  if(timer)clearInterval(timer);
  timer=null;
  if($('confirmation').open)$('confirmation').close();
  attempt=null;endAt=0;questions=[];idx=0;answers=new Map();flags=new Set();result=null;
  revision=0;savedRevision=0;saveJob=null;saveFailed=false;ended=false;closing=false;cachedSeconds=-1;
  for(const id of ['options','jump','review','score'])$(id).replaceChildren();
  for(const id of ['stem','question-title','progress','save-status','completion','confirm-summary'])$(id).textContent='';
  $('timer').textContent='4:20:00';
  $('filter').value='all';$('result-filter').value='all';
}
function block(text,{retry=true}={}){
  epoch++;retire();status();
  $('blocked-text').textContent=text;
  $('retry-access').hidden=!retry;
  show('blocked','blocked-title');
}
async function api(action,extra={}){
  if(!session)throw Object.assign(Error('signed out'),{code:401});
  const response=await fetch(BASE+'/functions/v1/website-mcq-mock',{
    method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:KEY,'Content-Type':'application/json'},
    body:JSON.stringify({action,...extra}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Object.assign(Error('mock request failed'),{code:response.status});
  return response.json();
}
function denied(error){
  if(error.code===401){block('Sign in to the Learning Portal using your active MCQ account.',{retry:false});return true}
  if(error.code===403){block('An active paid NeoClinIQ website MCQ subscription is required.',{retry:false});return true}
  return false;
}
function correctShape(q){return q&&typeof q.id==='string'&&typeof q.stem==='string'&&Array.isArray(q.options)&&q.options.length===4&&new Set(q.options.map(o=>o.id)).size===4&&q.options.every(o=>typeof o?.id==='string'&&typeof o?.text==='string')}
function setRemaining(data){
  const server=Date.parse(data.server_now),expiry=Date.parse(data.expires_at);
  if(!Number.isFinite(server)||!Number.isFinite(expiry))throw Error('unverified deadline');
  const candidate=elapsed()+Math.max(0,Math.min(expiry-server,15600000));
  endAt=endAt?Math.min(endAt,candidate):candidate;
}
function accept(data){
  if(data?.state==='available'){
    retire();status();$('start').disabled=false;show('entry','entry-title');return;
  }
  if(data?.state==='submitted'||data?.state==='expired'){
    if(!data.result)throw Error('missing closed result');
    renderResults(data);return;
  }
  if(data?.state!=='in_progress'||typeof data.attempt_id!=='string'||!Array.isArray(data.questions)||
     data.questions.length!==count||new Set(data.questions.map(q=>q.id)).size!==count||!data.questions.every(correctShape))throw Error('invalid exam');
  retire();attempt=data.attempt_id;setRemaining(data);questions=data.questions.map(({id,stem,options})=>({id,stem,options:options.map(({id,text})=>({id,text}))}));
  const byId=new Map(questions.map(q=>[q.id,q]));
  for(const row of data.answers||[])if(byId.get(row.question_id)?.options.some(o=>o.id===row.choice_id))answers.set(row.question_id,row.choice_id);
  for(const id of data.flags||[])if(byId.has(id))flags.add(id);
  const first=questions.findIndex(q=>!answers.has(q.id));
  idx=first===-1?0:first;
  status();show('active');drawQuestion(true);
  timer=setInterval(tick,250);tick();
}
async function checkAccess(action='status'){
  const token=++epoch;
  if(!session){block('Sign in to the Learning Portal using your active MCQ account.',{retry:false});return}
  retire();show('');status(action==='start'?'Opening your timed attempt…':'Checking your access…');
  try{
    const data=await api(action);
    if(token!==epoch)return;
    accept(data);
  }catch(error){
    if(token!==epoch||denied(error))return;
    block('The mock exam could not load. Check your connection and try again. If you already started, the timer continues.');
  }
}
function redrawControls(){
  const q=questions[idx];if(!q)return;
  $('clear').disabled=ended||closing||!answers.has(q.id);
  $('flag').disabled=ended||closing;
  $('flag').textContent=flags.has(q.id)?'Remove flag':'Flag for review';
  $('flag').setAttribute('aria-pressed',String(flags.has(q.id)));
  $('field').disabled=ended||closing;
  $('prev').disabled=idx===0;
  $('next').disabled=closing;
  $('next').textContent=idx===questions.length-1?'Review and submit':'Next';
  $('finish').disabled=closing;
  $('progress').textContent=answers.size+' of '+questions.length+' answered';
  const message=ended?(closing?'Time is up. Opening results…':'Time is up. View your results when connected.'):
    (closing?'Submitting…':saveFailed?'Changes not saved. Reconnect and retry.':revision===savedRevision?'Progress saved':'Saving your progress…');
  if($('save-status').textContent!==message)$('save-status').textContent=message;
  $('retry-save').hidden=!(saveFailed&&!ended&&!closing);
}
function drawNav(){
  const filter=$('filter').value,root=$('jump'),fragment=document.createDocumentFragment();
  let visible=0;
  questions.forEach((q,i)=>{
    const flag=flags.has(q.id),answered=answers.has(q.id);
    if(filter==='flagged'&&!flag||filter==='unanswered'&&answered)return;
    visible++;
    const button=el('button',String(i+1),[answered?'answered':'',flag?'flagged':''].join(' ').trim());
    button.type='button';
    button.dataset.index=String(i);
    if(idx===i)button.setAttribute('aria-current','step');
    button.setAttribute('aria-label','Question '+(i+1)+', '+(answered?'answered':'unanswered')+(flag?', flagged':''));
    if(flag){const mark=el('span','⚑','mark');mark.setAttribute('aria-hidden','true');button.append(mark)}
    fragment.append(button);
  });
  root.replaceChildren(fragment);
  $('nav-empty').hidden=visible!==0;
}
function drawQuestion(focus=false){
  const q=questions[idx],options=$('options');if(!q)return;
  $('question-title').textContent='Question '+(idx+1)+' of '+questions.length;
  $('stem').textContent=q.stem;
  const fragment=document.createDocumentFragment();
  q.options.forEach(({id,text},i)=>{
    const label=el('label',undefined,'choice'),input=el('input');
    input.type='radio';input.name='choice';input.value=id;input.checked=answers.get(q.id)===id;
    label.append(input,el('span',String.fromCharCode(65+i)+'. '+text));fragment.append(label);
  });
  options.replaceChildren(fragment);
  redrawControls();drawNav();
  if(focus)$('question-title').focus();
}
function change(i){if(Number.isInteger(i)&&i>=0&&i<questions.length){idx=i;drawQuestion(true)}}
function snapshot(){return {attempt_id:attempt,answers:[...answers].map(([question_id,choice_id])=>({question_id,choice_id})),flags:[...flags]}}
function edited(){
  revision++;saveFailed=false;
  redrawControls();drawNav();
  save();
}
function save(){
  if(saveJob||closing||ended||revision===savedRevision)return saveJob;
  if(elapsed()>=endAt){tick();return}
  const token=epoch,v=revision,payload=snapshot();
  saveJob=(async()=>{
    try{
      const response=await api('save',payload);
      if(token!==epoch)return;
      if(response.state==='submitted'||response.state==='expired'){accept(response);return}
      if(response.state!=='in_progress')throw Error('invalid save state');
      setRemaining(response);
      savedRevision=v;saveFailed=false;
    }catch(error){
      if(token!==epoch||denied(error))return;
      saveFailed=true;
    }finally{
      if(token===epoch&&view==='active'){
        saveJob=null;redrawControls();
        if(!saveFailed&&!closing&&!ended&&savedRevision<revision)queueMicrotask(save);
      }
    }
  })();
  return saveJob;
}
function tick(){
  if(view!=='active'||!endAt)return;
  const secs=Math.max(0,Math.ceil((endAt-elapsed())/1000));
  if(secs!==cachedSeconds){
    const pad=n=>String(n).padStart(2,'0');
    $('timer').textContent=Math.floor(secs/3600)+':'+pad(Math.floor(secs/60)%60)+':'+pad(secs%60);
    $('timer').classList.toggle('urgent',secs<=300);
    if(cachedSeconds>300&&secs<=300&&secs>0)status('Five minutes or less remain.');
    cachedSeconds=secs;
  }
  if(secs===0&&!ended){
    ended=true;
    if($('confirmation').open)$('confirmation').close();
    redrawControls();
    if(!closing)finish();
  }
}
function openConfirm(){
  tick();
  if(closing)return;
  if(ended){finish();return}
  $('confirm-summary').textContent=answers.size+' answered, '+(questions.length-answers.size)+' unanswered, '+flags.size+' flagged.';
  $('confirmation').showModal();
}
async function finish(){
  if(!attempt||closing)return;
  if($('confirmation').open)$('confirmation').close();
  closing=true;redrawControls();
  const token=epoch;
  if(saveJob)await saveJob;
  if(token!==epoch||view!=='active')return;
  try{
    const overtime=ended||elapsed()>=endAt;
    let data;
    if(overtime){
      const readResults=()=>api('results',{attempt_id:attempt});
      try{data=await readResults()}
      catch(error){
        if(error.code!==409)throw error;
        await new Promise(resolve=>setTimeout(resolve,1100));
        if(token!==epoch)return;
        data=await readResults();
      }
    }else{data=await api('submit',snapshot())}
    if(token!==epoch)return;
    if(!['expired','submitted'].includes(data.state))throw Error('invalid submission');
    if(!data.result)data=await api('results',{attempt_id:attempt});
    if(token!==epoch)return;
    accept(data);
  }catch(error){
    if(token!==epoch||denied(error))return;
    status('Could not confirm submission. Check your connection and select Review and submit to try again.');
    closing=false;redrawControls();
    $('finish').focus();
  }
}
function renderResults(data){
  const r=data.result;
  if(r.total!==count||![r.correct,r.wrong,r.unanswered].every(n=>Number.isInteger(n)&&n>=0)||
     r.correct+r.wrong+r.unanswered!==count||!Array.isArray(r.items)||r.items.length!==count)throw Error('invalid result');
  epoch++;retire();result=r;
  $('completion').textContent=data.state==='expired'?'Time expired. These results reflect the answers saved before the deadline.':'Your exam was submitted.';
  $('score').replaceChildren(...[r.correct+' / '+r.total+' correct',r.wrong+' incorrect',r.unanswered+' unanswered'].map(t=>el('span',t)));
  status();show('results','results-title');drawResults();
}
// Exact catalogue labels only. Fail closed on malformed metadata; never turn a title into a link.
const nonTitle=/(?:[<>\/\\\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]|www\.|(?:mailto|doi|javascript|vbscript|data|file|tel|sms):|%2f|%5c)/iu;
function relatedReadingTitles(value){
  if(!Array.isArray(value)||value.length>5)return [];
  return [...new Set(value.filter(title=>typeof title==='string'&&title.trim()!==''&&title.trim()===title&&Array.from(title).length<=300&&!nonTitle.test(title)))];
}
function drawResults(){
  if(!result)return;
  const filter=$('result-filter').value,fragment=document.createDocumentFragment();
  let shown=0;
  result.items.forEach((item,i)=>{
    const selected=item.selected_choice_id,kind=selected==null?'unanswered':(item.is_correct?'correct':'wrong');
    if(filter!=='all'&&kind!==filter)return;
    shown++;
    const tag={correct:'Correct',wrong:'Incorrect',unanswered:'Unanswered'}[kind];
    const option=id=>{
      if(id==null)return 'Not answered';
      const index=(item.options||[]).findIndex(o=>o.id===id);
      return index<0?'Not available':String.fromCharCode(65+index)+'. '+item.options[index].text;
    };
    const detail=el('details',undefined,'review-item');
    detail.append(el('summary','Question '+(i+1)+' · '+tag),el('p',item.stem),el('p','Your answer: '+option(selected)),el('p','Correct answer: '+option(item.correct_choice_id)));
    const explanation=item.correct_rationale||item.rationale;
    if(explanation)detail.append(el('p','Why the correct answer is best: '+explanation));
    if(kind==='wrong'&&item.selected_rationale)detail.append(el('p','Why your answer is not best: '+item.selected_rationale));
    const reading=relatedReadingTitles(item.related_reading_titles);
    if(reading.length){
      const list=el('ul',undefined,'reading-titles');
      for(const title of reading)list.append(el('li',title));
      detail.append(el('h3','Related reading in the SI Library'),list);
    }
    fragment.append(detail);
  });
  if(!shown)fragment.append(el('p','No questions match this filter.'));
  $('review').replaceChildren(fragment);
}
$('start').addEventListener('click',()=>{if(view==='entry')checkAccess('start')});
$('retry-access').addEventListener('click',()=>checkAccess());
$('retry-save').addEventListener('click',()=>{saveFailed=false;redrawControls();save()});
$('prev').addEventListener('click',()=>change(idx-1));
$('next').addEventListener('click',()=>idx===questions.length-1?openConfirm():change(idx+1));
$('jump').addEventListener('click',event=>{const button=event.target.closest('button[data-index]');if(button)change(Number(button.dataset.index))});
$('filter').addEventListener('change',drawNav);
$('result-filter').addEventListener('change',drawResults);
$('options').addEventListener('change',event=>{
  const q=questions[idx];tick();
  if(!q||ended||closing||!q.options.some(o=>o.id===event.target.value))return;
  answers.set(q.id,event.target.value);edited();
});
$('flag').addEventListener('click',()=>{
  const id=questions[idx]?.id;tick();if(!id||ended||closing)return;
  if(flags.has(id))flags.delete(id);else flags.add(id);
  edited();
});
$('clear').addEventListener('click',()=>{
  const id=questions[idx]?.id;tick();
  if(!id||ended||closing||!answers.delete(id))return;
  $('options').querySelectorAll('input').forEach(input=>{input.checked=false});
  edited();$('options').querySelector('input')?.focus();
});
$('finish').addEventListener('click',openConfirm);
$('cancel-submit').addEventListener('click',()=>$('confirmation').close());
$('confirm-submit').addEventListener('click',finish);
async function verifyVisibleAccess(){
  if(!session||!['active','results'].includes(view)||verificationPending)return;
  const token=epoch;verificationPending=true;
  try{await api('status',{compact:true})}
  catch(error){if(token===epoch)denied(error)}
  finally{verificationPending=false}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();verifyVisibleAccess()}});
window.addEventListener('pageshow',event=>{if(event.persisted){tick();verifyVisibleAccess()}});
setInterval(()=>{if(!document.hidden)verifyVisibleAccess()},60000);
window.addEventListener('online',()=>{if(view==='active'&&!ended&&saveFailed){saveFailed=false;save()}});
window.addEventListener('beforeunload',event=>{
  if(view==='active'&&!ended&&savedRevision<revision){event.preventDefault();event.returnValue=''}
});
client.auth.onAuthStateChange((_event,next)=>{
  const before=session?.user?.id;
  session=next;
  if(!loaded||before===next?.user?.id)return;
  if(!next)block('Your session ended. Sign in to the Learning Portal to continue.',{retry:false});
  else setTimeout(checkAccess,0);
});
try{
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  session=data.session;
  loaded=true;
  await checkAccess();
}catch{
  loaded=true;
  block('Your session could not be restored. Open the Learning Portal or try again.');
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BASE='https://uxnqoglkqptnslsdowxn.supabase.co';
const KEY='sb_publishable_v0uOpwZ-BBas2E7jyDkMXQ_TzNOHdAA';
const client=createClient(BASE,KEY);
const domainLabels={'1A':'Clinical Care','1B':'Distribution','2':'Knowledge and Expertise','3':'Communication and Collaboration','4':'Leadership and Stewardship','5':'Professionalism'};
const competencyCodes={'1A':['1.1','1.2','1.3','1.4','1.5'],'1B':['1.6','1.7','1.8','1.9','1.10'],'2':['2.2'],'3':['3.1','3.2','3.3','3.4'],'4':['4.2'],'5':['5.1','5.2','5.4','5.5']};
// Short learner-facing paraphrases of the official PEBC blueprint, version 03-2026.
const competencyLabels={
 '1.1':'Gather patient information','1.2':'Assess patient needs and health','1.3':'Develop the care plan',
 '1.4':'Put the care plan into action','1.5':'Monitor and adjust the plan','1.6':'Review and process a prescription',
 '1.7':'Prepare an item for dispensing','1.8':'Check product quality and accuracy','1.9':'Release verified items',
 '1.10':'Manage inventory safely','2.2':'Make evidence-informed decisions','3.1':'Communicate effectively',
 '3.2':'Partner with the patient','3.3':'Collaborate with other professionals','3.4':'Document care and services',
 '4.2':'Promote community health','5.1':'Follow legislation and regulations','5.2':'Use ethical judgment',
 '5.4':'Promote equity and inclusion','5.5':'Improve patient safety and quality',
};
const validChapter=/^[1-9][0-9]?\.[1-9][0-9]?$/;
const currentURL=new URL(location.href);
const seed=currentURL.searchParams;
const day=parseInt(seed.get('day'),10);
let planner=[...new Set(seed.getAll('planner').filter(v=>/^[0-9]{1,3}$/.test(v)).map(Number).filter(v=>v>=1&&v<=161))].slice(0,40);
let session=null,generation=0,request=null,action=0,chapters=[],byChapter=new Map(),rows=[],selectedIndex=0,nextCursor=null,total=0;
let choices=new Map(),answers=new Map(),written=new Map(),activeFilters=null;
const $=id=>document.getElementById(id);
function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n}
function status(message=''){$('notice').textContent=message}
function bstate(which){$('bank').hidden=which!=='bank';$('blocked').hidden=which!=='blocked'}
function wipe(){
  generation++; action++; request?.abort(); request=null;
  chapters=[];byChapter.clear();rows=[];selectedIndex=0;nextCursor=null;total=0;activeFilters=null;
  answers.clear();choices.clear();written.clear();
  for(const id of ['options','references','explanations','module','chapter'])$(id).replaceChildren();
  for(const id of ['question-title','question-meta','stem','feedback-title'])$(id).textContent='';
  $('written').value='';$('feedback').hidden=true;$('practice').hidden=true;$('empty').hidden=true;
}
function block(message,retry=false){
  wipe();bstate('blocked');status();
  $('blocked-text').textContent=message;$('retry').hidden=!retry;$('blocked-title').focus();
}
function denied(error){
  if(error.code===401){block('Sign in to the Learning Portal to use your MCQ Question Bank.');return true}
  if(error.code===403){block('An active paid NeoClinIQ website MCQ subscription is required.');return true}
  if(error.code===503&&!activeFilters){block('The subscriber question bank is not available yet. You can continue from the Learning Portal.',true);return true}
  return false;
}
async function api(type,extra={},signal){
  if(!session)throw Object.assign(Error('Signed out'),{code:401});
  const response=await fetch(BASE+'/functions/v1/website-mcq-bank',{
    method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:KEY,'Content-Type':'application/json'},
    body:JSON.stringify({action:type,...extra}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),
  });
  if(!response.ok)throw Object.assign(Error('Bank request failed'),{code:response.status});
  return response.json();
}
function listOption(select,value,label){const n=node('option',label);n.value=value;select.append(n)}
function drawCompetencies(){
  const select=$('competency');select.replaceChildren();listOption(select,'','All PEBC competencies');
  for(const [domain,group] of Object.entries(competencyCodes)){
    const optgroup=node('optgroup');optgroup.label=domain+' '+domainLabels[domain];
    listOption(optgroup,domain,'All '+domain+' '+domainLabels[domain]);
    for(const code of group)listOption(optgroup,code,code+' · '+competencyLabels[code]);
    select.append(optgroup);
  }
  listOption(select,'unclassified','Unclassified');
}
function bankScope(){
  $('plan-scope').hidden=!planner.length;
  $('plan-label').textContent=planner.length&&day>=1&&day<=112
    ? 'Showing questions for the topics in Day '+day+' of your Mastery Plan.'
    : 'Showing questions for the selected Mastery Plan session topics.';
}
function scoped(){return planner.length?chapters.filter(c=>c.planner_chapter_numbers.some(n=>planner.includes(n))):chapters}
function drawChapters(value=''){
  const select=$('chapter');select.replaceChildren();listOption(select,'','All chapters');
  for(const c of scoped())if(!$('module').value||Number($('module').value)===c.module_number)listOption(select,c.code,c.code+' · '+c.chapter_title);
  if([...select.options].some(o=>o.value===value))select.value=value;
}
function drawFilters(initial=false){
  const select=$('module');select.replaceChildren();listOption(select,'','All modules');
  const modules=new Map(scoped().map(c=>[c.module_number,c.module_title]));
  for(const [n,title] of modules)listOption(select,String(n),n+' · '+title);
  if(initial){
    const chapter=seed.get('chapter');
    const module=seed.get('module')||byChapter.get(chapter)?.module_number?.toString();
    if([...select.options].some(x=>x.value===module))select.value=module;
    drawChapters(chapter||'');
    drawCompetencies();
    const comp=seed.get('competency');
    if([...$('competency').options].some(x=>x.value===comp))$('competency').value=comp;
    $('track').value=seed.get('track')==='additional'?'additional':'single';
  }else drawChapters();
  bankScope();
}
function validCatalog(c){
  return c&&validChapter.test(c.code)&&Number.isInteger(c.module_number)&&typeof c.module_title==='string'&&typeof c.chapter_title==='string'
    &&Array.isArray(c.planner_chapter_numbers)&&c.planner_chapter_numbers.every(Number.isInteger);
}
async function boot(next){
  wipe();session=next;bstate('');status('Checking your subscription…');
  if(!session){block('Sign in to the Learning Portal to use your MCQ Question Bank.');return}
  const token=generation, controller=new AbortController();request=controller;
  try{
    const data=await api('catalog',{},controller.signal);
    if(token!==generation)return;
    if(!Array.isArray(data?.chapters)||!data.chapters.length||!data.chapters.every(validCatalog))throw Error('Missing chapter catalog');
    chapters=data.chapters;byChapter=new Map(chapters.map(c=>[c.code,c]));
    drawFilters(true);bstate('bank');await loadPage();
  }catch(error){
    if(token!==generation||denied(error))return;
    block('The question bank could not load. Check your connection, then try again.',true);
  }
}
function filterPayload(){
  return {module:Number($('module').value)||null,chapter:$('chapter').value||null,competency:$('competency').value||null,planner,track:$('track').value};
}
const writtenKind=q=>['fill_in','open_response'].includes(q.kind);
function validQuestion(q){
  return q&&typeof q.id==='string'&&byChapter.has(q.chapter_code)&&typeof q.stem==='string'
    &&['single','multi','fill_in','open_response'].includes(q.kind)
    &&Array.isArray(q.options)&&q.options.every(o=>typeof o.text==='string'&&/^[A-E]$/.test(o.id))
    &&(writtenKind(q)?!q.options.length:q.options.length>=2&&q.options.length<=5);
}
async function loadPage(append=false){
  if(append&&(!nextCursor||!activeFilters))return;
  const key=generation, serial=++action;
  request?.abort();const controller=new AbortController();request=controller;
  if(!append){
    activeFilters=filterPayload();rows=[];selectedIndex=0;nextCursor=null;total=0;
    for(const cap of [choices,answers,written])cap.clear();
    for(const id of ['stem','question-title','feedback-title'])$(id).textContent='';
    for(const id of ['options','references','explanations'])$(id).replaceChildren();
    $('empty').hidden=true;$('practice').hidden=true;
  }
  $('next').disabled=true;
  status('Loading questions…');
  try{
    const result=await api('list',{...activeFilters,after:append?nextCursor:null},controller.signal);
    if(key!==generation||serial!==action)return;
    if(!Array.isArray(result?.items)||!result.items.every(validQuestion)||!Number.isInteger(result.total)||
        (result.next_after!=null&&typeof result.next_after!=='string'))throw Error('Invalid question page');
    if(append){selectedIndex=rows.length;rows.push(...result.items);if(selectedIndex===rows.length)selectedIndex=Math.max(0,rows.length-1)}
    else rows=result.items;
    nextCursor=result.next_after;total=result.total;
    if(!rows.length&&planner.length&&!scoped().length){
      $('empty').textContent='No released practice questions are mapped to these study-day topics yet. Browse the full bank to find other chapters.';
    }else $('empty').textContent='No released questions match these filters. Try another practice type, chapter or competency.';
    $('empty').hidden=!!rows.length;
    $('practice').hidden=!rows.length;
    status(rows.length?total.toLocaleString('en-CA')+' questions match these filters.':'No matching questions.');
    if(rows.length)drawQuestion(append);
  }catch(error){
    if(key!==generation||serial!==action||denied(error))return;
    status('Questions could not load. Apply the filters again or retry the next question.');
    $('next').disabled=!append;
  }
}
function drawQuestion(focus=false){
  const q=rows[selectedIndex];if(!q)return;
  const chap=byChapter.get(q.chapter_code);
  const tag=q.competency_domain
    ? (q.competency_code?'Competency '+q.competency_code+' · ':'')+(domainLabels[q.competency_domain]||q.competency_domain)+(q.competency_status==='provisional'?' (preliminary)':'')
    : 'PEBC competency: Unclassified';
  $('question-meta').textContent=q.chapter_code+' '+chap.chapter_title+' · '+tag;
  $('question-title').textContent='Question '+(selectedIndex+1)+' of '+total.toLocaleString('en-CA');
  $('stem').textContent=q.stem;
  $('options').replaceChildren();
  $('options-field').hidden=writtenKind(q);
  $('written-field').hidden=!writtenKind(q);
  $('written').value=written.get(q.id)||'';
  $('written').oninput=()=>written.set(q.id,$('written').value);
  $('question-instruction').textContent=q.kind==='multi'?'Select all applicable answers.':'Choose one answer.';
  $('check').textContent=writtenKind(q)?'Show suggested answer':'Check answer';
  $('check').disabled=!writtenKind(q)&&!choices.get(q.id)?.length;
  const answered=answers.has(q.id);
  for(const opt of q.options){
    const label=node('label');label.className='bank-option';
    const input=node('input');input.type=q.kind==='multi'?'checkbox':'radio';input.name='choice';input.value=opt.id;
    input.checked=(choices.get(q.id)||[]).includes(opt.id);input.disabled=answered;
    input.onchange=()=>{
      const marked=[...$('options').querySelectorAll('input:checked')].map(input=>input.value);
      choices.set(q.id,marked);$('check').disabled=!marked.length;
    };
    label.append(input,node('span',opt.id+'. '+opt.text));$('options').append(label);
  }
  $('check').hidden=answered;
  $('written').disabled=answered;
  $('feedback').hidden=!answered;
  $('explanations').replaceChildren();$('references').replaceChildren();
  if(answered)review(q,answers.get(q.id));
  $('prev').disabled=selectedIndex===0;
  $('next').disabled=selectedIndex+1===rows.length&&!nextCursor;
  if(focus)$('question-title').focus();
}
function safeTitle(v){
  return typeof v==='string'&&v.length<=300&&v.trim()===v&&v.length>0&&
    !/[\/\\<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]|%2f|%5c|www\.|mailto:|doi:|javascript:|vbscript:|data:|file:|tel:|sms:/i.test(v);
}
function review(q,result){
  $('feedback').hidden=false;
  if(writtenKind(q)){
    $('feedback-title').textContent='Suggested answer · self-assess your response';
    $('explanations').append(node('strong',result.expected_answer),node('p',result.answer_rationale));
  }else{
    $('feedback-title').textContent=result.correct?'Correct':'Not quite';
    const keys=new Set(result.correct_option_ids);
    const marked=new Set(choices.get(q.id)||[]);
    for(const opt of q.options){
      const card=node('div');card.className='bank-choice-result';card.dataset.correct=String(keys.has(opt.id));card.dataset.selected=String(marked.has(opt.id));
      card.append(node('strong',opt.id+'. '+(keys.has(opt.id)?'Correct answer':'Incorrect option')+(marked.has(opt.id)?' · Your choice':'')),
        node('p',opt.text),node('p',result.option_rationales[opt.id]));
      $('explanations').append(card);
    }
  }
  const names=(Array.isArray(result.reference_titles)?result.reference_titles:[]).filter(safeTitle);
  $('references').append(node('h4','Quiz references'));
  if(names.length){
    const list=node('ul');for(const name of names)list.append(node('li',name));
    if(names.length>5){
      const disclosure=node('details');
      disclosure.append(node('summary','Show '+names.length+' notebook source filenames'),
        node('p','These are source names from the notebook for this quiz, not citations for individual answers.'),list);
      $('references').append(disclosure);
    }else $('references').append(list);
  }else $('references').append(node('p','No quiz reference filename is listed for this question.'));
}
$('answer-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const q=rows[selectedIndex],key=generation,serial=action;
  if(!q||answers.has(q.id)||$('check').disabled)return;
  $('check').disabled=true;$('options-field').disabled=true;
  const selected=choices.get(q.id)||[];
  try{
    const result=await api('answer',{item:q.id,selected});
    if(key!==generation||serial!==action||q.id!==rows[selectedIndex]?.id)return;
    if(result?.id!==q.id||result.kind!==q.kind||
      (writtenKind(q)?typeof result.expected_answer!=='string'||typeof result.answer_rationale!=='string':
        typeof result.correct!=='boolean'||!Array.isArray(result.correct_option_ids)||
        !q.options.every(o=>typeof result.option_rationales?.[o.id]==='string')))throw Error('Missing feedback');
    answers.set(q.id,result);
    drawQuestion();$('feedback-title').focus();
  }catch(error){
    if(key!==generation||serial!==action||denied(error))return;
    status('Your feedback could not load. Check your connection and try again.');
    $('check').disabled=false;
  }finally{if(key===generation&&serial===action)$('options-field').disabled=false}
});
function step(increment){
  action++;
  $('options-field').disabled=false;
  if(increment===1&&selectedIndex+1===rows.length){if(nextCursor)void loadPage(true);return}
  const next=selectedIndex+increment;
  if(next<0||next>=rows.length)return;
  selectedIndex=next;drawQuestion(true);
}
$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);
$('module').onchange=()=>drawChapters();
$('filters').addEventListener('submit',event=>{event.preventDefault();$('options-field').disabled=false;void loadPage()});
$('clear-plan').onclick=()=>{
  planner=[];const url=new URL(location.href);url.searchParams.delete('planner');url.searchParams.delete('day');history.replaceState(null,'',url);
  drawFilters();$('options-field').disabled=false;void loadPage();
};
$('retry').onclick=()=>boot(session);
let sessionVersion=0,bootstrapped=false,currentUser=null;
function handle(next){
  const id=next?.user?.id||null;
  if(bootstrapped&&id===currentUser){session=next;return}
  bootstrapped=true;currentUser=id;void boot(next);
}
client.auth.onAuthStateChange((_event,next)=>{const version=++sessionVersion;if(!next&&session){session=null;block('Sign in to the Learning Portal to use your MCQ Question Bank.')}setTimeout(()=>{if(version===sessionVersion)handle(next)},0)});
const initVersion=sessionVersion;
const {data}=await client.auth.getSession();
if(initVersion===sessionVersion)handle(data?.session||null);

import fs from "node:fs";
import {test} from "node:test";
import assert from "node:assert/strict";
import {PGlite} from "@electric-sql/pglite";

const owner="10000000-0000-0000-0000-000000000001";
const owner2="10000000-0000-0000-0000-000000000002";
const expired="10000000-0000-0000-0000-000000000003";
const owner3="10000000-0000-0000-0000-000000000004";
const free="10000000-0000-0000-0000-000000000005";
const osce="10000000-0000-0000-0000-000000000006";
const noPayment="10000000-0000-0000-0000-000000000007";
const disputed="10000000-0000-0000-0000-000000000008";
const reference="20000000-0000-0000-0000-000000000001";
const form="30000000-0000-0000-0000-000000000001";
const expiredAttempt="40000000-0000-0000-0000-000000000001";
const blueprint=[
  [100,"clinical_care",["1.1","1.2","1.3","1.4","1.5"]],
  [40,"distribution",["1.6","1.7","1.8","1.9","1.10"]],
  [22,"knowledge_expertise",["2.2"]],
  [8,"communication_collaboration",["3.1","3.2","3.3","3.4"]],
  [6,"leadership_stewardship",["4.2"]],
  [24,"professionalism",["5.1","5.2","5.4","5.5"]],
].flatMap(([n,domain,codes])=>Array.from({length:n},(_,i)=>[domain,codes[i%codes.length]]));

test("private database API and immutable, 200-item, server-timed attempt", async ()=>{
 const db = new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.program_entitlements(user_id uuid,program text,active bool,expires_at timestamptz,source text);
    create table public.website_payments(user_id uuid,program text,purchase_type text,status text,amount_cents int,
      stripe_payment_intent_id text,stripe_checkout_session_id text);
    create table public.website_payment_reconciliation(user_id uuid,case_type text, stripe_payment_intent_id text,
      stripe_checkout_session_id text, details jsonb);
    grant select on public.program_entitlements,public.website_payments,public.website_payment_reconciliation to service_role;
    create table public.original_reference_documents(id uuid primary key,title text,indexing_status text,source_url text,drive_file_id text);`);
  const migration=fs.readFileSync(new URL("../supabase/migrations/20261124051000_private_mcq_mock.sql",import.meta.url),"utf8");
  await db.exec(migration);
  await db.query("insert into auth.users select unnest(\$1::uuid[])",[[owner,owner2,expired,owner3,free,osce,noPayment,disputed]]);
  await db.query(`insert into public.program_entitlements values
    (\$1,'mcq',true,clock_timestamp()+interval '1 day','stripe_website'),
    (\$2,'mcq',true,clock_timestamp()+interval '1 day','stripe_website'),
    (\$3,'mcq',true,clock_timestamp()-interval '1 day','stripe_website'),
    (\$4,'mcq',true,clock_timestamp()+interval '1 day','stripe_website'),
    (\$5,'mcq',true,clock_timestamp()+interval '1 day','founder_test'),
    (\$6,'osce',true,clock_timestamp()+interval '1 day','stripe_website'),
    (\$7,'mcq',true,clock_timestamp()+interval '1 day','stripe_website')`,[owner,owner2,expired,owner3,free,osce,noPayment]);
  await db.query(`insert into public.website_payments(user_id,program,purchase_type,status,amount_cents) values
    (\$1,'mcq','initial','fulfilled',150000),(\$2,'mcq','initial','fulfilled',150000),
    (\$3,'mcq','initial','fulfilled',150000),(\$4,'mcq','initial','fulfilled',150000),
    (\$5,'osce','initial','fulfilled',180000),(\$6,'mcq','initial','rejected',150000)`,[owner,owner2,expired,owner3,osce,noPayment]);
  await db.query("update public.website_payments set stripe_payment_intent_id='fixture-refund' where user_id=$1",[noPayment]);
  await db.query("update public.website_payments set status='fulfilled' where user_id=$1",[noPayment]);
  await db.query("insert into public.website_payment_reconciliation(user_id,case_type,stripe_payment_intent_id,details) values ($1,'refund_succeeded','fixture-refund',$2)",[noPayment,JSON.stringify({amount_refunded:150000})]);
  await db.query("insert into public.program_entitlements values ($1,'mcq',true,clock_timestamp()+interval '1 day','stripe_website')",[disputed]);
  await db.query("insert into public.website_payments values ($1,'mcq','initial','fulfilled',150000,'fixture-dispute','fixture-session')",[disputed]);
  await db.query("insert into public.website_payment_reconciliation values ($1,'dispute_opened','fixture-dispute','fixture-session',null)",[disputed]);
  await db.query("insert into public.original_reference_documents values (\$1,'SI Library Fixture Title','indexed','https://example.invalid/NEVER_RETURN','private-drive-id')",[reference]);
  await db.query("insert into private.mcq_mock_forms (id,name,version) values (\$1,'Synthetic fixture only','fixture-1')",[form]);
  let run=(action,user=owner,attempt=null,answers=[],flags=[],compact=false)=>db.query(
    "select public.website_mcq_mock_action(\$1,\$2,\$3,\$4,\$5,\$6) as v",
    [user,action,attempt,JSON.stringify(answers),JSON.stringify(flags),compact]).then(r=>r.rows[0].v);
  async function role(name,fn) {
   await db.exec("set role "+name);
   try{return await fn()}finally{await db.exec("reset role")}
  }
  for(const name of ["anon","authenticated"]) await role(name,async()=>{
   await assert.rejects(run("status"),/permission denied/);
   await assert.rejects(db.query("select correct_index from private.mcq_mock_items"),/permission denied/);
  });
  await role("service_role",async()=>{
   assert.equal((await run("start")).status,503,"unreleased forms must not start");
   for(const id of [expired,free,osce,noPayment,disputed])assert.equal((await run("status",id)).status,403);
  });
  await db.query("insert into public.website_payment_reconciliation values ($1,'dispute_closed','fixture-dispute','fixture-session',$2)",[disputed,JSON.stringify({dispute_status:"won"})]);
  await role("service_role",async()=>assert.equal((await run("status",disputed)).status,503,"won dispute has paid access but fixture form is not yet released"));
  await assert.rejects(db.query("update private.mcq_mock_forms set reviewed_by=\$1,reviewed_at=now(),released_at=now() where id=\$2",[owner,form]),/200-question blueprint/);
  await db.query(`insert into private.mcq_mock_items(form_id,position,competency,competency_code,competency_mapping_note,authoring_key,provenance,provenance_note,reviewed_by,reviewed_at,stem,options,
    correct_index,rationale,option_rationales,source_ids,source_titles,source_locators)
    select \$1,row_number() over (order by s.n),s.domain,s.code,'Fixture mapping note','fixture-item-'||s.n,'original','Not real exam material',\$2,now(),
    'Synthetic question '||row_number() over (order by s.n),array['A fixture','B fixture','C fixture','D fixture'],
    2,'Reviewed fixture explanation',array['Why A is wrong','Why B is correct','Why C is wrong','Why D is wrong'],
    array[\$3::uuid],array['SI Library Fixture Title'],array['Unit test section']
    from unnest(\$4::text[],\$5::text[]) with ordinality s(domain,code,n)`,[form,owner,reference,blueprint.map(x=>x[0]),blueprint.map(x=>x[1])]);
  const declared=await db.query("select count(*) as n from private.mcq_mock_blueprint_2026_03()");
  assert.equal(Number(declared.rows[0].n),20);
  assert.equal((await db.query("select count(*) as n from private.mcq_mock_items where competency_code='1.10' and competency='distribution'")).rows.map(x=>Number(x.n))[0],8);
  await assert.rejects(db.query("update private.mcq_mock_items set competency_code=null where position=1"),/not-null/);
  await assert.rejects(db.query("update private.mcq_mock_items set competency_code='1.6' where position=1"),/mcq_mock_competency_matches_blueprint/);
  await assert.rejects(db.query("update private.mcq_mock_items set competency_code='2.1' where position=141"),/mcq_mock_competency_matches_blueprint/);
  await assert.rejects(db.query("update private.mcq_mock_items set competency_mapping_note='  ' where position=1"),/competency_mapping_note/);
  await db.query("update private.mcq_mock_items set competency_code='1.1' where competency_code='1.5'");
  await assert.rejects(db.query("update private.mcq_mock_forms set reviewed_by=$1,reviewed_at=now(),released_at=now() where id=$2",[owner,form]),/all 20 listed PEBC competencies/);
  await db.query("update private.mcq_mock_items set competency_code='1.5' where competency='clinical_care' and position%5=0");
  // Keep all codes and 200 items but shift one question into the wrong domain total.
  await db.query("update private.mcq_mock_items set competency='distribution',competency_code='1.6' where position=1");
  await assert.rejects(db.query("update private.mcq_mock_forms set reviewed_by=$1,reviewed_at=now(),released_at=now() where id=$2",[owner,form]),/200-question blueprint/);
  await db.query("update private.mcq_mock_items set competency='clinical_care',competency_code='1.1' where position=1");
  await assert.rejects(db.query("update private.mcq_mock_items set blueprint_version='2025-01' where position=1"),/mcq_mock_competency_matches_blueprint/);
  await assert.rejects(db.query("update private.mcq_mock_items set authoring_key='fixture-item-2' where position=1"),/unique constraint/);
  // Identical title is not enough: it must match an actual indexed catalog identifier.
  await db.query("update private.mcq_mock_items set source_ids=array[gen_random_uuid()] where position=10");
  await assert.rejects(db.query("update private.mcq_mock_forms set reviewed_by=\$1,reviewed_at=now(),released_at=now() where id=\$2",[owner,form]),/indexed-reference/);
  await db.query("update private.mcq_mock_items set source_ids=array[\$1::uuid] where position=10",[reference]);
  await db.query("update private.mcq_mock_forms set reviewed_by=\$1,reviewed_at=now(),released_at=now() where id=\$2",[owner,form]);
  await assert.rejects(db.query("update private.mcq_mock_items set correct_index=3 where position=1"),/immutable/);
  await assert.rejects(db.query("update private.mcq_mock_forms set reviewed_by=null"),/immutable/);

  await db.query(`insert into private.mcq_mock_attempts (id,user_id,form_id,started_at,expires_at,answers)
    select \$1,\$2,\$3,now()-interval '261 min',now()-interval '1 min',
    jsonb_build_object(id::text,md5(id::text||':2')) from private.mcq_mock_items where position=1`,[expiredAttempt,owner3,form]);
  await role("service_role",async()=>{
   await assert.rejects(db.query("update private.mcq_mock_items set correct_index=4"),/permission denied/);
   assert.equal((await run("status")).body.state,"available");
   const a=(await run("start")).body;
   const b=(await run("start",owner2)).body;
   assert.equal(a.state,"in_progress");
   assert.equal(a.questions.length,200);
   assert.ok(a.questions.every(q=>q.options.length===4 && Object.keys(q).length===3 && q.options.every(x=>Object.keys(x).length===2)));
   assert.equal(Date.parse(a.expires_at)-Date.parse(a.started_at),260*60*1000);
   const text=JSON.stringify(a);
   assert.ok(!/correct|rationale|source|competency|Fixture mapping note|fixture-item-|NEVER_RETURN|private-drive-id/i.test(text));
   assert.equal((await run("status",owner,a.attempt_id,[],[],true)).body.questions,undefined);
   assert.equal((await run("start")).body.attempt_id,a.attempt_id,"start retry resumes, not a new timer");
   assert.equal((await run("results",owner,a.attempt_id)).status,409);
   assert.equal((await run("status",owner,b.attempt_id)).status,404);
   assert.equal((await run("save",owner,b.attempt_id)).status,404);
   const [p,q]=a.questions;
   assert.equal((await run("save",owner,a.attempt_id,[{question_id:p.id,choice_id:q.options[0].id}],[])).status,400);
   const pick=(item,idx)=>({question_id:item.id,choice_id:item.options[idx].id});
   assert.equal((await run("save",owner,a.attempt_id,[pick(p,1),pick(p,0)],[])).status,400);
   assert.equal((await run("save",owner,a.attempt_id,[],[p.id,p.id])).status,400);
   await run("save",owner,a.attempt_id,[pick(p,1)],[p.id]);
   const empty=(await run("save",owner,a.attempt_id,[],[])).body;
   assert.deepEqual(empty.answers,[]);assert.deepEqual(empty.flags,[]);
   const answers=[pick(p,1),pick(q,0)];
   const [saved,submit]=await Promise.all([
    run("save",owner,a.attempt_id,[pick(p,1)],[p.id]),
    run("submit",owner,a.attempt_id,answers,[])
   ]);
   assert.equal(saved.status,200);assert.equal(submit.body.state,"submitted");
   const r=submit.body.result;
   assert.equal(r.correct,1);assert.equal(r.wrong,1);assert.equal(r.unanswered,198);
   assert.equal(r.items[0].correct_rationale,"Why B is correct");
   assert.equal(r.items[1].selected_rationale,"Why A is wrong");
   assert.equal(r.items[2].selected_rationale,null);
   assert.deepEqual(r.items[0].source_titles,["SI Library Fixture Title"]);
   assert.ok(!JSON.stringify(r).includes("NEVER_RETURN"));
   assert.ok(!JSON.stringify(r).includes("private-drive-id"));
   assert.ok(!JSON.stringify(r).includes(reference));
   assert.ok(!/competency_code|competency_mapping_note|Fixture mapping note|fixture-item-/.test(JSON.stringify(r)));
   const retry=(await run("submit",owner,a.attempt_id,[pick(p,0)],[])).body.result;
   const stale=(await run("save",owner,a.attempt_id,[],[])).body.result;
   assert.deepEqual(retry,r);assert.deepEqual(stale,r);
   // Server-controlled expiry includes only last on-time answers; after reopen no timer reset.
   const late=(await run("submit",owner3,expiredAttempt,[pick(p,0)],[p.id])).body;
   assert.equal(late.state,"expired");assert.equal(late.result.correct,1);assert.equal(late.result.wrong,0);
   const reopened=(await run("status",owner3)).body;
   assert.equal(reopened.attempt_id,expiredAttempt);assert.deepEqual(reopened.result,late.result);
  });
 } finally {await db.close()}
});

begin;
create schema if not exists private;
create table private.mcq_bank_chapters (
  code text primary key check(code ~ '^[1-9][0-9]?\.[1-9][0-9]?$'),
  module_number integer not null check(module_number between 1 and 14),
  module_title text not null check(length(btrim(module_title)) between 1 and 120),
  chapter_title text not null check(length(btrim(chapter_title)) between 1 and 200),
  planner_chapter_numbers integer[] not null default '{}',
  check(split_part(code,'.',1)=module_number::text),
  check(0 < all(planner_chapter_numbers) and 161 >= all(planner_chapter_numbers) and array_position(planner_chapter_numbers,null) is null)
);

create function private.mcq_bank_code_domain(code text) returns text
language sql immutable strict set search_path='' as $$
  select case
    when code in ('1.1','1.2','1.3','1.4','1.5') then '1A'
    when code in ('1.6','1.7','1.8','1.9','1.10') then '1B'
    when code='2.2' then '2'
    when code in ('3.1','3.2','3.3','3.4') then '3'
    when code='4.2' then '4'
    when code in ('5.1','5.2','5.4','5.5') then '5'
  end
$$;
create function private.mcq_bank_safe_title(title text) returns boolean
language sql immutable strict set search_path='' as $$
  select length(title) between 1 and 300 and title=btrim(title)
    and strpos(title,'/')=0 and strpos(title,chr(92))=0
    and title !~* '(www\.|mailto:|doi:|javascript:|vbscript:|data:|file:|tel:|sms:|%2f|%5c|[<>[:cntrl:]])'
    and title !~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]'
$$;
create function private.mcq_bank_titles_ok(titles text[]) returns boolean
language sql immutable strict set search_path='' as $$
  select cardinality(titles) <= 160 and array_position(titles,null) is null
    and not exists (select 1 from unnest(titles) t where not private.mcq_bank_safe_title(t))
    and (select count(distinct t)=cardinality(titles) from unnest(titles) t)
$$;
create function private.mcq_bank_item_shape(kind text, opts jsonb, keys text[], rationales jsonb, expected text, explanation text)
returns boolean language plpgsql immutable set search_path='' as $$
declare n integer;
begin
  if opts is null or jsonb_typeof(opts)<>'array' or keys is null or rationales is null or jsonb_typeof(rationales)<>'object' then return false; end if;
  n:=jsonb_array_length(opts);
  if kind in ('fill_in','open_response') then
    return n=0 and cardinality(keys)=0 and rationales='{}'::jsonb
      and coalesce(length(btrim(expected)) between 1 and 3000,false)
      and coalesce(length(btrim(explanation)) between 1 and 5000,false);
  end if;
  if kind not in ('single','multi') or expected is not null or explanation is not null or n not between 2 and 5
     or (kind='single' and cardinality(keys)<>1)
     or (kind='multi' and cardinality(keys) not between 2 and n)
     or array_position(keys,null) is not null
     or cardinality(keys)<>(select count(distinct k) from unnest(keys) k) then return false; end if;
  if exists (select 1 from jsonb_array_elements(opts) o
    where jsonb_typeof(o)<>'object' or coalesce(o->>'id','') !~ '^[A-E]$'
    or jsonb_typeof(o->'text') is distinct from 'string' or length(btrim(o->>'text')) not between 1 and 3000
    or jsonb_typeof(rationales->(o->>'id')) is distinct from 'string'
    or length(btrim(rationales->>(o->>'id'))) not between 1 and 5000) then return false; end if;
  return n=(select count(distinct o->>'id') from jsonb_array_elements(opts) o)
    and n=(select count(*) from jsonb_object_keys(rationales))
    and not exists (select 1 from unnest(keys) k where not rationales ? k);
end
$$;
create table private.mcq_bank_items (
  id text primary key check(id ~ '^NCQ-[1-9][0-9]?\.[1-9][0-9]?-S[0-9]{2}-Q[0-9]{2}$'),
  chapter_code text not null references private.mcq_bank_chapters(code),
  kind text not null check(kind in ('single','multi','fill_in','open_response')),
  stem text not null check(length(btrim(stem)) between 1 and 5000),
  options jsonb not null default '[]',
  correct_option_ids text[] not null default '{}',
  option_rationales jsonb not null default '{}',
  expected_answer text,
  answer_rationale text,
  competency_domain text check(competency_domain in ('1A','1B','2','3','4','5')),
  competency_code text,
  competency_status text not null default 'unclassified' check(competency_status in ('verified','provisional','unclassified')),
  reference_titles text[] not null default '{}',
  released boolean not null default false,
  check(id like 'NCQ-'||chapter_code||'-%'),
  check(private.mcq_bank_item_shape(kind,options,correct_option_ids,option_rationales,expected_answer,answer_rationale)),
  check((competency_status='unclassified' and competency_domain is null and competency_code is null)
     or (competency_status='provisional' and competency_domain is not null
       and (competency_code is null or private.mcq_bank_code_domain(competency_code) is not distinct from competency_domain))
     or (competency_status='verified' and competency_domain is not null and competency_code is not null
       and private.mcq_bank_code_domain(competency_code) is not distinct from competency_domain)),
  check(private.mcq_bank_titles_ok(reference_titles))
);
-- The privileged import records observed filenames for the exact saved quiz.
-- The roster contains no source IDs or links and is not readable by subscribers.
create table private.mcq_bank_quiz_references (
  set_id text primary key check(set_id ~ '^NCQ-[1-9][0-9]?[.][1-9][0-9]?-S[0-9]{2}$'),
  titles text[] not null check(cardinality(titles)>0 and private.mcq_bank_titles_ok(titles))
);
alter table private.mcq_bank_quiz_references enable row level security;
revoke all on private.mcq_bank_quiz_references from public,anon,authenticated;

create function private.mcq_bank_refs_approved(item_id text, titles text[]) returns boolean
language sql stable strict set search_path='' as $$
  select cardinality(titles)>0 and private.mcq_bank_titles_ok(titles) and coalesce(
    (select r.titles=$2 from private.mcq_bank_quiz_references r
      where r.set_id=split_part($1,'-Q',1)),
    cardinality(titles)<=5 and not exists (
      select 1 from unnest(titles) t(title)
      where not exists(select 1 from public.original_reference_documents d
        where d.title=t.title and d.indexing_status='indexed')
    )
  )
$$;
revoke all on function private.mcq_bank_refs_approved(text,text[]) from public,anon,authenticated;

create function private.mcq_bank_validate_release() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.released and not private.mcq_bank_refs_approved(new.id,new.reference_titles)
  then raise exception 'Approved quiz roster or indexed SI Library source titles are required before releasing an item.'; end if;
  return new;
end
$$;
create trigger mcq_bank_validate_release before insert or update on private.mcq_bank_items
for each row execute function private.mcq_bank_validate_release();

create index mcq_bank_release_filters on private.mcq_bank_items (kind,chapter_code,competency_domain,competency_code,id) where released;
alter table private.mcq_bank_items enable row level security;
alter table private.mcq_bank_chapters enable row level security;
revoke all on private.mcq_bank_items,private.mcq_bank_chapters from public,anon,authenticated;

create function private.mcq_bank_paid_access(p_user_id uuid) returns boolean
language sql stable set search_path='' as $$
  select exists (
    select 1 from public.program_entitlements e
    where e.user_id=p_user_id and e.program='mcq' and e.active and e.expires_at>clock_timestamp() and e.source='stripe_website'
  ) and exists (
    select 1 from public.website_payments w
    where w.user_id=p_user_id and w.program='mcq' and w.status='fulfilled'
      and w.purchase_type in ('initial','extension') and w.amount_cents>0
      and not exists (
        select 1 from public.website_payment_reconciliation r
        where r.user_id=w.user_id
          and (r.stripe_payment_intent_id=w.stripe_payment_intent_id or r.stripe_checkout_session_id=w.stripe_checkout_session_id)
          and (
            (r.case_type='refund_succeeded' and
             case when coalesce(r.details->>'amount_refunded','') ~ '^[0-9]{1,15}$'
               then (r.details->>'amount_refunded')::bigint>=w.amount_cents else true end)
            or (r.case_type='dispute_closed' and coalesce(r.details->>'dispute_status','') <> 'won')
            or (r.case_type='dispute_opened' and not exists (
              select 1 from public.website_payment_reconciliation won
              where won.user_id=w.user_id and won.case_type='dispute_closed' and won.details->>'dispute_status'='won'
                and (won.stripe_payment_intent_id=w.stripe_payment_intent_id or won.stripe_checkout_session_id=w.stripe_checkout_session_id)
            ))
          )
      )
  )
$$;

create function public.website_mcq_bank_action(
  p_user_id uuid,p_action text,p_module integer default null,p_chapter text default null,
  p_competency text default null,p_planner integer[] default '{}',p_track text default 'single',
  p_after text default null,p_item text default null,p_selected text[] default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare body jsonb;
declare item private.mcq_bank_items%rowtype;
declare ref_names jsonb;
declare correct boolean;
begin
  if p_user_id is null or p_action is null or p_action not in ('status','catalog','list','answer') then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid action.'));
  end if;
  if not private.mcq_bank_paid_access(p_user_id) then
    return jsonb_build_object('status',403,'body',jsonb_build_object('error','An active paid website MCQ subscription is required.'));
  end if;
  if p_action in ('status','catalog') and not exists(select 1 from private.mcq_bank_items where released) then
    return jsonb_build_object('status',503,'body',jsonb_build_object('error','The question bank is not available yet.'));
  end if;
  if p_action='status' then
    return jsonb_build_object('status',200,'body',jsonb_build_object('state','available'));
  end if;
  if p_action='catalog' then
    select jsonb_agg(to_jsonb(q) order by q.module_number,split_part(q.code,'.',2)::int) into body from (
      select c.code,c.module_number,c.module_title,c.chapter_title,c.planner_chapter_numbers,
        count(*) filter(where i.kind='single') as single_count,
        count(*) filter(where i.kind<>'single') as additional_count
      from private.mcq_bank_chapters c join private.mcq_bank_items i on i.chapter_code=c.code and i.released
      group by c.code
    ) q;
    return jsonb_build_object('status',200,'body',jsonb_build_object('chapters',coalesce(body,'[]'::jsonb)));
  end if;
  if p_action='list' then
    if not coalesce(p_track in ('single','additional'),false)
      or (p_module is not null and p_module not between 1 and 14)
      or (p_chapter is not null and p_chapter !~ '^[1-9][0-9]?\.[1-9][0-9]?$')
      or (p_competency is not null and p_competency not in ('1A','1B','2','3','4','5','unclassified')
        and private.mcq_bank_code_domain(p_competency) is null)
      or p_planner is null or cardinality(p_planner)>40 or array_position(p_planner,null) is not null
      or not (0 < all(p_planner) and 161 >= all(p_planner))
      or (p_after is not null and p_after !~ '^NCQ-[1-9][0-9]?\.[1-9][0-9]?-S[0-9]{2}-Q[0-9]{2}$')
    then return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid filters.')); end if;
    with matched as materialized (
      select i.id,i.chapter_code,i.kind,i.stem,i.options,i.competency_domain,i.competency_code,i.competency_status
      from private.mcq_bank_items i join private.mcq_bank_chapters c on c.code=i.chapter_code
      where i.released and ((p_track='single')=(i.kind='single'))
        and (p_module is null or c.module_number=p_module)
        and (p_chapter is null or c.code=p_chapter)
        and (cardinality(p_planner)=0 or c.planner_chapter_numbers && p_planner)
        and (p_competency is null or i.competency_domain=p_competency or i.competency_code=p_competency
          or (p_competency='unclassified' and i.competency_status='unclassified'))
    ), page as (
      select * from matched where p_after is null or id>p_after order by id limit 13
    ), shown as (
      select id,chapter_code,kind,stem,competency_domain,competency_code,competency_status,
        (select coalesce(jsonb_agg(jsonb_build_object('id',o->>'id','text',o->>'text') order by n),'[]'::jsonb)
         from jsonb_array_elements(options) with ordinality t(o,n)) as options
      from page order by id limit 12
    )
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from shown s),'[]'::jsonb),
      'next_after',case when (select count(*) from page)>12 then (select max(id) from shown) end,
      'total',(select count(*) from matched)) into body;
    return jsonb_build_object('status',200,'body',body);
  end if;
  if p_item is null or p_item !~ '^NCQ-[1-9][0-9]?\.[1-9][0-9]?-S[0-9]{2}-Q[0-9]{2}$'
    then return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid question.')); end if;
  select * into item from private.mcq_bank_items where id=p_item and released;
  if not found then return jsonb_build_object('status',404,'body',jsonb_build_object('error','Question not available.')); end if;
  if p_selected is null or cardinality(p_selected)>5 or array_position(p_selected,null) is not null
    or cardinality(p_selected)<>(select count(distinct k) from unnest(p_selected) k)
    or exists (select 1 from unnest(p_selected) k where not item.option_rationales ? k)
    or (item.kind='single' and cardinality(p_selected)<>1)
    or (item.kind='multi' and cardinality(p_selected)<1)
    or (item.kind in ('fill_in','open_response') and cardinality(p_selected)<>0)
    then return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid answer choice.')); end if;
  -- Recheck that these exact quiz-level names remain approved. Return text only.
  if not private.mcq_bank_refs_approved(item.id,item.reference_titles) then
    return jsonb_build_object('status',503,'body',jsonb_build_object('error','This question is temporarily unavailable.'));
  end if;
  ref_names:=to_jsonb(item.reference_titles);
  if item.kind in ('fill_in','open_response') then
    body:=jsonb_build_object('id',item.id,'kind',item.kind,'expected_answer',item.expected_answer,
      'answer_rationale',item.answer_rationale,'reference_titles',ref_names);
  else
    correct:=p_selected @> item.correct_option_ids and item.correct_option_ids @> p_selected;
    body:=jsonb_build_object('id',item.id,'kind',item.kind,'correct',correct,'correct_option_ids',item.correct_option_ids,
      'option_rationales',item.option_rationales,'reference_titles',ref_names);
  end if;
  return jsonb_build_object('status',200,'body',body);
end
$$;
revoke all on function public.website_mcq_bank_action(uuid,text,integer,text,text,integer[],text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.website_mcq_bank_action(uuid,text,integer,text,text,integer[],text,text,text,text[]) to service_role;
commit;

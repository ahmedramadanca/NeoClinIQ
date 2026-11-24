begin;
create schema if not exists private;

-- Official PEBC Part I Blueprint v03-2026, effective May 2026.
-- Domain item counts are exact here; PEBC does not publish per-code quotas.
create function private.mcq_mock_blueprint_2026_03()
returns table(official_domain_code text,domain_slug text,domain_items integer,competency_code text)
language sql immutable set search_path='' as $$
  select d.domain_code,d.slug,d.items,c.code
  from (values
    ('1A','clinical_care',100,array['1.1','1.2','1.3','1.4','1.5']),
    ('1B','distribution',40,array['1.6','1.7','1.8','1.9','1.10']),
    ('2','knowledge_expertise',22,array['2.2']),
    ('3','communication_collaboration',8,array['3.1','3.2','3.3','3.4']),
    ('4','leadership_stewardship',6,array['4.2']),
    ('5','professionalism',24,array['5.1','5.2','5.4','5.5'])
  ) as d(domain_code,slug,items,codes)
  cross join lateral unnest(d.codes) as c(code)
$$;

create function private.mcq_mock_competency_in_blueprint(version text,domain text,code text)
returns boolean language sql immutable strict set search_path='' as $$
  select version='2026-03' and exists (
    select 1 from private.mcq_mock_blueprint_2026_03() b
    where b.domain_slug=domain and b.competency_code=code
  )
$$;

create table private.mcq_mock_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  version text not null unique check (length(btrim(version)) between 1 and 50),
  blueprint_version text not null default '2026-03' check (blueprint_version='2026-03'),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  released_at timestamptz,
  unique (id,blueprint_version)
);
create table private.mcq_mock_items (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null,
  blueprint_version text not null default '2026-03',
  position integer not null check (position between 1 and 200),
  competency text not null,
  competency_code text not null,
  competency_mapping_note text not null check (length(competency_mapping_note)<=500 and competency_mapping_note ~ '[^[:space:]]'),
  authoring_key text not null check (authoring_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$'),
  provenance text not null check (provenance in ('original','licensed')),
  provenance_note text not null check (length(btrim(provenance_note)) between 1 and 500),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null,
  stem text not null check (length(btrim(stem)) between 1 and 5000),
  options text[] not null check (cardinality(options)=4 and array_ndims(options)=1 and array_lower(options,1)=1),
  correct_index integer not null check (correct_index between 1 and 4),
  rationale text not null check (length(btrim(rationale)) between 1 and 5000),
  option_rationales text[] not null check (cardinality(option_rationales)=4 and array_ndims(option_rationales)=1 and array_lower(option_rationales,1)=1),
  source_ids uuid[] not null check (cardinality(source_ids) between 1 and 5 and array_ndims(source_ids)=1 and array_lower(source_ids,1)=1),
  source_titles text[] not null check (cardinality(source_titles)=cardinality(source_ids) and array_ndims(source_titles)=1 and array_lower(source_titles,1)=1),
  source_locators text[] not null check (cardinality(source_locators)=cardinality(source_ids) and array_ndims(source_locators)=1 and array_lower(source_locators,1)=1),
  unique (form_id,position),
  unique (form_id,authoring_key),
  foreign key (form_id,blueprint_version) references private.mcq_mock_forms(id,blueprint_version) on delete restrict,
  constraint mcq_mock_competency_matches_blueprint check (
    private.mcq_mock_competency_in_blueprint(blueprint_version,competency,competency_code)
  )
);
create table private.mcq_mock_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  form_id uuid not null references private.mcq_mock_forms(id) on delete restrict,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  finalized_at timestamptz,
  state text not null default 'in_progress' check (state in ('in_progress','submitted','expired')),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers)='object'),
  flags uuid[] not null default '{}',
  unique(user_id,form_id),
  check (expires_at=started_at + interval '260 minutes'),
  check ((state='in_progress')=(finalized_at is null))
);

alter table private.mcq_mock_forms enable row level security;
alter table private.mcq_mock_items enable row level security;
alter table private.mcq_mock_attempts enable row level security;
revoke all on private.mcq_mock_forms, private.mcq_mock_items, private.mcq_mock_attempts from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select on private.mcq_mock_forms, private.mcq_mock_items to service_role;
grant select, insert, update on private.mcq_mock_attempts to service_role;

create function private.mcq_mock_freeze_item()
returns trigger language plpgsql set search_path='' as $$
declare
  form_key uuid := case when tg_op='INSERT' then new.form_id else old.form_id end;
  release_time timestamptz;
begin
  if tg_op='UPDATE' and new.form_id is distinct from old.form_id then
    raise exception 'Mock items cannot move between forms';
  end if;
  -- Shared lock order with the form publisher; edits cannot slip past validation.
  select f.released_at into release_time from private.mcq_mock_forms f where f.id=form_key for update;
  if not found then raise exception 'Unknown mock form'; end if;
  if release_time is not null then raise exception 'Released mock forms are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;
create trigger mcq_mock_freeze_items before insert or update or delete on private.mcq_mock_items
  for each row execute function private.mcq_mock_freeze_item();

create function private.mcq_mock_freeze_form()
returns trigger language plpgsql set search_path='' as $$
declare source_count integer;
begin
  if tg_op='INSERT' then
    if new.released_at is not null then raise exception 'Create a draft before release'; end if;
    return new;
  end if;
  if old.released_at is not null then raise exception 'Released mock forms are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.released_at is null then return new; end if;
  if new.id is distinct from old.id or new.reviewed_by is null or new.reviewed_at is null or new.reviewed_at>clock_timestamp() then
    raise exception 'Form review is required before release';
  end if;
  select count(*) into source_count from private.mcq_mock_items where form_id=old.id;
  if source_count<>200 or exists (
    select 1
    from (select distinct domain_slug,domain_items from private.mcq_mock_blueprint_2026_03()) q
    where (select count(*) from private.mcq_mock_items i where i.form_id=old.id and i.competency=q.domain_slug)<>q.domain_items
  ) then raise exception 'Mock form must match the 200-question blueprint'; end if;
  if exists (
    select 1 from private.mcq_mock_blueprint_2026_03() b
    where not exists (
      select 1 from private.mcq_mock_items i where i.form_id=old.id and i.blueprint_version=new.blueprint_version
        and i.competency=b.domain_slug and i.competency_code=b.competency_code
    )
  ) then raise exception 'Mock form must cover all 20 listed PEBC competencies'; end if;
  if (select count(distinct lower(regexp_replace(btrim(stem),'[[:space:]]+',' ','g'))) from private.mcq_mock_items where form_id=old.id)<>200 then
    raise exception 'Duplicate stems are not permitted';
  end if;
  if exists (
    select 1 from private.mcq_mock_items i where i.form_id=old.id and (
      i.reviewed_at>new.reviewed_at
      or (select count(distinct lower(btrim(o))) from unnest(i.options) as u(o))<>4
      or exists (select 1 from unnest(i.options) as u(o) where o is null or length(btrim(o)) not between 1 and 1300)
      or exists (select 1 from unnest(i.option_rationales) as u(r) where r is null or length(btrim(r)) not between 1 and 3000)
      or exists (select 1 from unnest(array_prepend(i.rationale,i.option_rationales)) as u(r) where r ~* '([a-z][a-z0-9+.-]*://|www\.|mailto:|doi:|\]\(|<\s*a\s|drive\.google\.com|storage/v1/)')
      or (select count(distinct d) from unnest(i.source_ids) as u(d))<>cardinality(i.source_ids)
      or exists (
        select 1 from generate_subscripts(i.source_ids,1) s(k)
        left join public.original_reference_documents d on d.id=i.source_ids[s.k]
        where d.id is null or d.indexing_status is distinct from 'indexed'
          or d.title is distinct from i.source_titles[s.k]
          or i.source_locators[s.k] is null or length(btrim(i.source_locators[s.k])) not between 1 and 500
          or i.source_titles[s.k] is null or length(btrim(i.source_titles[s.k])) not between 1 and 300
          or i.source_titles[s.k] ~* '([a-z][a-z0-9+.-]*://|www\.|mailto:|doi:|\]\(|<|>|[[:cntrl:]]|drive\.google\.com|storage/v1/)'
      )
    )
  ) then raise exception 'A question is missing review, valid options, rationales or indexed-reference labels'; end if;
  new.released_at := clock_timestamp();
  return new;
end
$$;
create trigger mcq_mock_freeze_forms before insert or update or delete on private.mcq_mock_forms
  for each row execute function private.mcq_mock_freeze_form();

-- An API choice ID is opaque to the student and independent of the answer key.
create function private.mcq_mock_options(item_id uuid, choices text[])
returns jsonb language sql immutable strict set search_path='' as $$
  select jsonb_agg(jsonb_build_object('id',md5(item_id::text||':'||o.n::text),'text',o.choice) order by o.n)
  from unnest(choices) with ordinality o(choice,n)
$$;

-- Only the authenticated Edge Function's backend role may invoke this RPC.
-- It resolves identity itself from the session before injecting p_user_id.
create function public.website_mcq_mock_action(
  p_user_id uuid, p_action text, p_attempt_id uuid default null,
  p_answers jsonb default '[]'::jsonb, p_flags jsonb default '[]'::jsonb, p_compact boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  t timestamptz;
  form_row private.mcq_mock_forms%rowtype;
  a private.mcq_mock_attempts%rowtype;
  response jsonb;
  data jsonb;
  questions jsonb;
  submitted_answers jsonb;
  submitted_flags uuid[];
  matched_answers int;
  matched_flags int;
  correct_count int;
  wrong_count int;
  unanswered_count int;
begin
  if p_user_id is null or p_action is null or p_action not in ('status','start','save','submit','results') then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid mock examination action.'));
  end if;
  if p_action in ('save','submit','results') and p_attempt_id is null then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','An attempt ID is required.'));
  end if;

  -- Serialize all attempts for one learner, including start and terminal operations.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,24052026));
  t:=clock_timestamp();
  if not exists (
    select 1 from public.program_entitlements e
    where e.user_id=p_user_id and e.program='mcq' and e.active and e.expires_at>t and e.source='stripe_website'
  ) or not exists (
    select 1 from public.website_payments w
    where w.user_id=p_user_id and w.program='mcq' and w.status='fulfilled'
      and w.purchase_type in ('initial','extension') and w.amount_cents>0
      and not exists (
        -- A fulfilled ledger row may remain after a refund/dispute is recorded.
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
  ) then
    return jsonb_build_object('status',403,'body',jsonb_build_object('error','An active paid website MCQ subscription is required.'));
  end if;

  if p_attempt_id is not null then
    select * into a from private.mcq_mock_attempts where id=p_attempt_id and user_id=p_user_id for update;
    if not found then return jsonb_build_object('status',404,'body',jsonb_build_object('error','Attempt not found.')); end if;
  else
    select * into a from private.mcq_mock_attempts
      where user_id=p_user_id and state='in_progress' order by started_at desc,id desc limit 1 for update;
    if not found then
      select * into form_row from private.mcq_mock_forms where released_at is not null
        order by released_at desc,id desc limit 1;
      if not found then
        return jsonb_build_object('status',503,'body',jsonb_build_object('error','The reviewed mock exam is not yet available.'));
      end if;
      select * into a from private.mcq_mock_attempts where user_id=p_user_id and form_id=form_row.id for update;
      if not found and p_action='start' then
        t:=clock_timestamp();
        insert into private.mcq_mock_attempts(user_id,form_id,started_at,expires_at)
          values(p_user_id,form_row.id,t,t+interval '260 minutes') returning * into a;
      end if;
    end if;
  end if;
  if a.id is null then
    return jsonb_build_object('status',200,'body',jsonb_build_object('state','available','server_now',clock_timestamp()));
  end if;

  t:=clock_timestamp();
  if a.state='in_progress' and t>=a.expires_at then
    update private.mcq_mock_attempts set state='expired',finalized_at=a.expires_at where id=a.id returning * into a;
  end if;
  if a.state='in_progress' and p_action in ('save','submit') then
    if coalesce(jsonb_typeof(p_answers),'null')<>'array' or coalesce(jsonb_typeof(p_flags),'null')<>'array' then
      return jsonb_build_object('status',400,'body',jsonb_build_object('error','Answers and flags must be arrays.'));
    end if;
    if jsonb_array_length(p_answers)>200 or jsonb_array_length(p_flags)>200 then
      return jsonb_build_object('status',400,'body',jsonb_build_object('error','Too many answers or flags.'));
    end if;
    select coalesce(jsonb_object_agg(i.id::text,j.row->>'choice_id'),'{}'::jsonb),count(distinct i.id)
      into submitted_answers,matched_answers
      from jsonb_array_elements(p_answers) as j(row)
      join private.mcq_mock_items i on i.form_id=a.form_id and i.id::text=j.row->>'question_id'
      where jsonb_typeof(j.row)='object'
        and exists (select 1 from generate_series(1,4) k(n) where md5(i.id::text||':'||k.n::text)=j.row->>'choice_id');
    select coalesce(array_agg(i.id order by i.position),'{}'::uuid[]),count(distinct i.id)
      into submitted_flags,matched_flags from jsonb_array_elements_text(p_flags) as p(fid)
      join private.mcq_mock_items i on i.form_id=a.form_id and i.id::text=p.fid;
    if matched_answers<>jsonb_array_length(p_answers) or matched_flags<>jsonb_array_length(p_flags) then
      return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid or duplicate answer or flag.'));
    end if;

    -- Recheck after reading and validating the full snapshot, using the DB clock.
    t:=clock_timestamp();
    if t>=a.expires_at then
      update private.mcq_mock_attempts set state='expired',finalized_at=a.expires_at where id=a.id returning * into a;
    else
      update private.mcq_mock_attempts set answers=submitted_answers,flags=submitted_flags,
        state=case when p_action='submit' then 'submitted' else 'in_progress' end,
        finalized_at=case when p_action='submit' then t else null end
        where id=a.id returning * into a;
    end if;
  end if;

  response:=jsonb_build_object('state',a.state,'server_now',clock_timestamp(),'attempt_id',a.id,
    'started_at',a.started_at,'expires_at',a.expires_at);
  if p_compact and p_action='status' then return jsonb_build_object('status',200,'body',response); end if;

  if a.state='in_progress' then
    if p_action='results' then
      return jsonb_build_object('status',409,'body',jsonb_build_object('error','Results unlock after submission or expiry.'));
    end if;
    if p_action in ('status','start') then
      select jsonb_agg(jsonb_build_object('id',i.id,'stem',i.stem,'options',private.mcq_mock_options(i.id,i.options)) order by i.position)
        into questions from private.mcq_mock_items i where i.form_id=a.form_id;
      response:=response||jsonb_build_object('questions',questions);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('question_id',key,'choice_id',value)),'[]'::jsonb)
      into data from jsonb_each_text(a.answers);
    response:=response||jsonb_build_object('answers',data,'flags',to_jsonb(a.flags));
    return jsonb_build_object('status',200,'body',response);
  end if;

  select
    count(*) filter (where d.selected_id=d.correct_id),
    count(*) filter (where d.selected_id is not null and d.selected_id<>d.correct_id),
    count(*) filter (where d.selected_id is null),
    jsonb_agg(jsonb_build_object(
      'question_id',d.id,'stem',d.stem,'options',private.mcq_mock_options(d.id,d.options),
      'selected_choice_id',d.selected_id,'correct_choice_id',d.correct_id,
      'is_correct',case when d.selected_id is null then null else d.selected_id=d.correct_id end,
      'rationale',d.rationale,'correct_rationale',d.option_rationales[d.correct_index],
      'selected_rationale',case when d.selected_id is not null then
        d.option_rationales[(select n from generate_series(1,4) p(n) where md5(d.id::text||':'||p.n::text)=d.selected_id)]
        else null end,
      'source_titles',to_jsonb(d.source_titles)
    ) order by d.position)
    into correct_count,wrong_count,unanswered_count,data
    from (select i.*,a.answers->>i.id::text as selected_id,
      md5(i.id::text||':'||i.correct_index::text) as correct_id from private.mcq_mock_items i where i.form_id=a.form_id) d;
  response:=response||jsonb_build_object('result',jsonb_build_object('correct',correct_count,'wrong',wrong_count,
    'unanswered',unanswered_count,'total',200,'items',data));
  return jsonb_build_object('status',200,'body',response);
end
$$;

revoke all on function private.mcq_mock_blueprint_2026_03() from public, anon, authenticated, service_role;
revoke all on function private.mcq_mock_competency_in_blueprint(text,text,text) from public, anon, authenticated, service_role;
revoke all on function private.mcq_mock_freeze_item() from public, anon, authenticated, service_role;
revoke all on function private.mcq_mock_freeze_form() from public, anon, authenticated, service_role;
revoke all on function private.mcq_mock_options(uuid,text[]) from public, anon, authenticated, service_role;
grant execute on function private.mcq_mock_options(uuid,text[]) to service_role;
revoke all on function public.website_mcq_mock_action(uuid,text,uuid,jsonb,jsonb,boolean) from public, anon, authenticated, service_role;
grant execute on function public.website_mcq_mock_action(uuid,text,uuid,jsonb,jsonb,boolean) to service_role;
commit;

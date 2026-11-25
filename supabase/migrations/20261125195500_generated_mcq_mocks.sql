begin;
-- Isolated additional timed practice series. No original tables, RPC, or attempts are modified.
create function private.generated_mcq_blueprint()
returns table(domain text,quota integer,code text)
language sql immutable set search_path='' as $$
  select q.domain,q.quota,c.code
  from (values
    ('1A',100,array['1.1','1.2','1.3','1.4','1.5']),
    ('1B',40,array['1.6','1.7','1.8','1.9','1.10']),
    ('2',22,array['2.2']),
    ('3',8,array['3.1','3.2','3.3','3.4']),
    ('4',6,array['4.2']),
    ('5',24,array['5.1','5.2','5.4','5.5'])
  ) q(domain,quota,codes) cross join lateral unnest(q.codes) c(code)
$$;
create function private.generated_mcq_domain(code text) returns text
language sql immutable strict set search_path='' as $$
  select b.domain from private.generated_mcq_blueprint() b where b.code=$1
$$;
create function private.generated_mcq_stem_key(stem text) returns text
language sql immutable strict set search_path='' as $$
  select btrim(lower(regexp_replace(normalize(stem,NFKC),'[^[:alnum:]]+',' ','g')))
$$;
create function private.generated_mcq_disclaimer() returns text
language sql immutable set search_path='' as $$
  select 'Additional timed practice. Source competency tags are preliminary. Not an official PEBC exam, not endorsed by PEBC, and no independent clinical review is claimed.'
$$;
create function private.generated_mcq_names_safe(titles text[]) returns boolean
language sql immutable strict set search_path='' as $$
  select cardinality(titles)<=160 and array_position(titles,null) is null
    and (select count(distinct lower(t))=cardinality(titles) from unnest(titles) t)
    and not exists(select 1 from unnest(titles) t
      where not private.mcq_mock_safe_reading_title(t)
        or t ~* '[a-z][a-z0-9+.-]*://')
$$;
create function private.generated_mcq_choice_shape(choices text[],correct_at integer,rationales text[]) returns boolean
language sql immutable strict set search_path='' as $$
  select cardinality(choices)=4 and array_ndims(choices)=1 and array_lower(choices,1)=1
    and correct_at between 1 and 4 and cardinality(rationales)=4 and array_ndims(rationales)=1 and array_lower(rationales,1)=1
    and (select count(distinct lower(btrim(x)))=4 from unnest(choices) x)
    and not exists(select 1 from unnest(choices) x where x is null or length(btrim(x)) not between 1 and 1300)
    and not exists(select 1 from unnest(rationales) x where x is null or length(btrim(x)) not between 1 and 5000
      or x ~* '([a-z][a-z0-9+.-]*://|www[.]|mailto:|doi:|<\s*a\s|drive[.]google[.]com|storage/v1/)')
$$;
-- Private intake. A provisional topic mapping is not automatically eligible for the series.
create table private.generated_mcq_candidates (
  source_id text primary key check(source_id ~ '^NCQ-[1-9][0-9]?[.][1-9][0-9]?-S[0-9]{2}-Q[0-9]{2}$'),
  stem text not null check(length(btrim(stem)) between 1 and 5000),
  stem_key text generated always as (private.generated_mcq_stem_key(stem)) stored not null check(length(stem_key)>0),
  competency_code text not null,
  domain text not null check(private.generated_mcq_domain(competency_code) is not distinct from domain),
  options text[] not null,
  correct_index integer not null,
  option_rationales text[] not null,
  reference_titles text[] not null default '{}',
  series_eligible boolean not null default false,
  eligibility_note text,
  check(private.generated_mcq_choice_shape(options,correct_index,option_rationales)),
  check(private.generated_mcq_names_safe(reference_titles)),
  check(not series_eligible or (
    cardinality(reference_titles)>0 and coalesce(length(btrim(eligibility_note)) between 1 and 2000,false)
  ))
);
create table private.generated_mcq_forms (
  id uuid primary key default gen_random_uuid(),
  form_number integer not null unique check(form_number between 1 and 20),
  title text not null check(length(btrim(title)) between 1 and 160),
  sampler_seed text not null check(length(sampler_seed) between 1 and 200),
  original_reference_form_id uuid not null references private.mcq_mock_forms(id) on delete restrict,
  competency_basis text not null default 'preliminary' check(competency_basis='preliminary'),
  editorial_approval_source text,
  approval_note text,
  released_at timestamptz,
  check(released_at is null or (coalesce(editorial_approval_source ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{8,160}$',false)
    and coalesce(length(btrim(approval_note)) between 1 and 2000,false)))
);
create table private.generated_mcq_form_items (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references private.generated_mcq_forms(id) on delete restrict,
  position integer not null check(position between 1 and 200),
  source_kind text not null check(source_kind in ('bank','original')),
  source_id text not null check(length(source_id) between 1 and 100),
  domain text not null,
  competency_code text not null check(private.generated_mcq_domain(competency_code) is not distinct from domain),
  stem text not null check(length(btrim(stem)) between 1 and 5000),
  stem_key text generated always as (private.generated_mcq_stem_key(stem)) stored not null check(length(stem_key)>0),
  options text[] not null,
  correct_index integer not null,
  option_rationales text[] not null,
  reference_titles text[] not null default '{}',
  unique(form_id,position),
  unique(form_id,source_id),
  unique(form_id,stem_key),
  check(source_kind<>'original' or domain in ('1B','3','4','5')),
  check(private.generated_mcq_choice_shape(options,correct_index,option_rationales)),
  check(private.generated_mcq_names_safe(reference_titles))
);
create unique index generated_clinical_stem_once on private.generated_mcq_form_items(stem_key) where domain='1A';
create unique index generated_clinical_source_once on private.generated_mcq_form_items(source_id) where domain='1A';
create index generated_mcq_item_sources on private.generated_mcq_form_items(source_id);
create index generated_mcq_item_stems on private.generated_mcq_form_items(stem_key);
create table private.generated_mcq_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  form_id uuid not null references private.generated_mcq_forms(id) on delete restrict,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  finalized_at timestamptz,
  state text not null default 'in_progress' check(state in ('in_progress','submitted','expired')),
  answers jsonb not null default '{}' check(jsonb_typeof(answers)='object'),
  flags uuid[] not null default '{}',
  unique(user_id,form_id),
  check(expires_at=started_at+interval '260 minutes'),
  check((state='in_progress')=(finalized_at is null))
);
create unique index generated_one_active_attempt on private.generated_mcq_attempts(user_id) where state='in_progress';
alter table private.generated_mcq_candidates enable row level security;
alter table private.generated_mcq_forms enable row level security;
alter table private.generated_mcq_form_items enable row level security;
alter table private.generated_mcq_attempts enable row level security;
revoke all on private.generated_mcq_candidates,private.generated_mcq_forms,private.generated_mcq_form_items,private.generated_mcq_attempts
  from public,anon,authenticated,service_role;

create function private.generated_mcq_guard_item() returns trigger
language plpgsql set search_path='' as $$
declare
  k uuid:=case when tg_op='INSERT' then new.form_id else old.form_id end;
  snap private.generated_mcq_forms%rowtype;
  canon text;
  old_id uuid;
begin
  -- Use shared lock order across private assembly and release transactions.
  perform pg_advisory_xact_lock(358842,20);
  select * into snap from private.generated_mcq_forms where id=k for update;
  if not found then raise exception 'Unknown generated form'; end if;
  if snap.released_at is not null then raise exception 'Released generated form items are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' then
    old_id:=old.id;
    if old.form_id is distinct from new.form_id then raise exception 'Cannot move a generated item'; end if;
  end if;
  canon:=private.generated_mcq_stem_key(new.stem);
  if exists(select 1 from private.generated_mcq_form_items x
    where x.id is distinct from old_id and (x.stem_key=canon or x.source_id=new.source_id)
      and (x.domain='1A' or new.domain='1A')) then
    raise exception 'Clinical Care items cannot repeat across generated forms';
  end if;
  if exists(select 1 from private.mcq_mock_items i join private.mcq_mock_forms f on f.id=i.form_id
    where f.id=snap.original_reference_form_id and f.released_at is not null and i.competency='clinical_care'
      and private.generated_mcq_stem_key(i.stem)=canon) then
    raise exception 'Clinical Care items cannot repeat from the original form';
  end if;
  return new;
end
$$;
create trigger generated_mcq_item_immutable before insert or update or delete on private.generated_mcq_form_items
for each row execute function private.generated_mcq_guard_item();

create function private.generated_mcq_guard_form() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.released_at is not null then raise exception 'Generate a private draft first'; end if;
    return new;
  end if;
  if old.released_at is not null then raise exception 'Released generated forms are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.original_reference_form_id is distinct from old.original_reference_form_id or new.id is distinct from old.id then
    raise exception 'Cannot re-key or relink a generated form';
  end if;
  if new.released_at is null then return new; end if;
  if not coalesce(new.editorial_approval_source ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{8,160}$',false)
    or not coalesce(length(btrim(new.approval_note)) between 1 and 2000,false) then
    raise exception 'Explicit release approval is required';
  end if;
  if (select count(*) from private.generated_mcq_form_items i where i.form_id=old.id)<>200
    or exists(select 1 from (select distinct b.domain,b.quota from private.generated_mcq_blueprint() b) b
      where (select count(*) from private.generated_mcq_form_items i where i.form_id=old.id and i.domain=b.domain)<>b.quota)
    or exists(select 1 from private.generated_mcq_blueprint() b
      where not exists(select 1 from private.generated_mcq_form_items i where i.form_id=old.id and i.competency_code=b.code))
  then raise exception 'Generated form must contain 200 items and cover all blueprint quotas and 20 codes'; end if;
  if exists(select 1 from private.generated_mcq_form_items i where i.form_id=old.id and (
    (i.source_kind='bank' and (cardinality(i.reference_titles)=0 or not exists(select 1 from private.generated_mcq_candidates c
      where c.source_id=i.source_id and c.series_eligible
        and (i.stem,i.domain,i.competency_code,i.options,i.correct_index,i.option_rationales,i.reference_titles)
          is not distinct from (c.stem,c.domain,c.competency_code,c.options,c.correct_index,c.option_rationales,c.reference_titles)))) or
    (i.source_kind='original' and not exists(select 1 from private.mcq_mock_items o join private.mcq_mock_forms f on f.id=o.form_id
      where f.id=old.original_reference_form_id and f.released_at is not null
        and coalesce(btrim(to_jsonb(f)->>'editorial_approval_source'),'')<>''
        and i.source_id='original:'||o.id::text and private.generated_mcq_domain(o.competency_code) in ('1B','3','4','5')
        and (i.stem,i.domain,i.competency_code,i.options,i.correct_index,i.option_rationales,i.reference_titles)
          is not distinct from (o.stem,private.generated_mcq_domain(o.competency_code),o.competency_code,o.options,
            o.correct_index,o.option_rationales,coalesce(o.related_reading_titles,'{}'::text[]))))
  )) then raise exception 'Generated form contains missing or ineligible item provenance or references'; end if;
  new.released_at:=clock_timestamp();
  return new;
end
$$;
create trigger generated_mcq_form_immutable before insert or update or delete on private.generated_mcq_forms
for each row execute function private.generated_mcq_guard_form();

-- Operator-only batch assembly. The original form UUID is explicit; no runtime "latest" fallback.
-- Each call is atomic. No body, keys, or frozen draft are created when a quota cannot be met.
create function private.build_generated_mcq_series(p_original_form uuid,p_seed text,p_count integer default 20)
returns table(form_id uuid,form_number integer)
language plpgsql security definer set search_path='' as $$
declare
  start_no integer;
  fn integer;
  remain integer;
  n integer;
  code text;
  form_key uuid;
begin
  if p_count is null or p_count not between 1 and 20 or p_seed is null or length(btrim(p_seed)) not between 1 and 200 then
    raise exception 'A private seed and batch size between 1 and 20 are required';
  end if;
  perform pg_advisory_xact_lock(358842,20);
  if not exists(select 1 from private.mcq_mock_forms f where f.id=p_original_form and f.released_at is not null
    and coalesce(btrim(to_jsonb(f)->>'editorial_approval_source'),'')<>'') then
    raise exception 'A fixed released original form with recorded owner approval is required to assemble the additional series';
  end if;
  if exists(select 1 from private.generated_mcq_forms f where f.original_reference_form_id<>p_original_form) then
    raise exception 'All generated forms must use the same fixed original';
  end if;
  select coalesce(max(f.form_number),0)+1 into start_no from private.generated_mcq_forms f;
  if start_no+p_count-1>20 then raise exception 'The approved series is limited to 20 additional forms'; end if;

  drop table if exists pg_temp.generated_mcq_pool;
  drop table if exists pg_temp.generated_mcq_picks;
  drop table if exists pg_temp.generated_mcq_seen;
  create temporary table generated_mcq_pool on commit drop as
    with source as (
      select c.source_id,'bank'::text as source_kind,c.domain,c.competency_code,c.stem,c.stem_key,c.options,c.correct_index,
        c.option_rationales,c.reference_titles
      from private.generated_mcq_candidates c where c.series_eligible
      union all
      select 'original:'||i.id::text,'original',private.generated_mcq_domain(i.competency_code),i.competency_code,
        i.stem,private.generated_mcq_stem_key(i.stem),i.options,i.correct_index,i.option_rationales,coalesce(i.related_reading_titles,'{}'::text[])
      from private.mcq_mock_items i
      where i.form_id=p_original_form and private.generated_mcq_domain(i.competency_code) in ('1B','3','4','5')
        and private.generated_mcq_choice_shape(i.options,i.correct_index,i.option_rationales)
        and private.generated_mcq_names_safe(coalesce(i.related_reading_titles,'{}'::text[]))
    ), dedup as (
      select distinct on (s.stem_key) s.* from source s
      where not exists(select 1 from private.mcq_mock_items o
        where o.form_id=p_original_form and o.competency='clinical_care' and private.generated_mcq_stem_key(o.stem)=s.stem_key)
      and not exists(select 1 from private.generated_mcq_form_items j
        where (j.stem_key=s.stem_key or j.source_id=s.source_id) and (j.domain='1A' or s.domain='1A'))
      order by s.stem_key,(s.source_kind='original'),s.source_id
    ) select * from dedup;
  create unique index on pg_temp.generated_mcq_pool(source_id);
  create temporary table generated_mcq_picks(source_id text primary key) on commit drop;
  create temporary table generated_mcq_seen(source_id text primary key,uses integer not null) on commit drop;
  insert into pg_temp.generated_mcq_seen
    select i.source_id,count(*)::integer from private.generated_mcq_form_items i group by i.source_id;
  select count(*) into n from pg_temp.generated_mcq_pool x where x.domain='1A';
  if n<p_count*100 then raise exception 'Clinical Care capacity: % unique eligible items, % required',n,p_count*100; end if;
  for code in select b.code from private.generated_mcq_blueprint() b where b.domain='1A' order by b.code loop
    select count(*) into n from pg_temp.generated_mcq_pool x where x.competency_code=code;
    if n<p_count then raise exception 'Clinical Care competency % capacity: % eligible exclusive items, % required',code,n,p_count; end if;
  end loop;
  for fn in start_no..(start_no+p_count-1) loop
    remain:=start_no+p_count-1-fn;
    truncate pg_temp.generated_mcq_picks;
    insert into pg_temp.generated_mcq_picks
      select distinct on (p.competency_code) p.source_id from pg_temp.generated_mcq_pool p
      left join pg_temp.generated_mcq_seen s on s.source_id=p.source_id
      where p.domain<>'1A' or s.source_id is null
      order by p.competency_code,(p.source_kind='original'),coalesce(s.uses,0),md5(p_seed||':'||fn||':'||p.source_id),p.source_id;
    get diagnostics n=row_count;
    if n<>20 then
      select string_agg(b.code,', ' order by b.code) into code from private.generated_mcq_blueprint() b
      where not exists(select 1 from pg_temp.generated_mcq_picks a join pg_temp.generated_mcq_pool p on p.source_id=a.source_id
        where p.competency_code=b.code);
      raise exception 'Missing eligible competencies for generated form %: %',fn,code;
    end if;
    with remainder as (
      select p.source_id,p.domain,p.competency_code,p.source_kind,coalesce(s.uses,0) use_count,
        md5(p_seed||':'||fn||':'||p.source_id) tie,
        count(*) over(partition by p.competency_code) code_count,
        row_number() over(partition by p.competency_code
          order by (p.source_kind='original'),coalesce(s.uses,0),md5(p_seed||':'||fn||':'||p.source_id),p.source_id) code_rank
      from pg_temp.generated_mcq_pool p
      left join pg_temp.generated_mcq_seen s on s.source_id=p.source_id
      where not exists(select 1 from pg_temp.generated_mcq_picks a where a.source_id=p.source_id)
        and (p.domain<>'1A' or s.source_id is null)
    ), domain_ranks as (
      select r.*,row_number() over(partition by r.domain order by (r.source_kind='original'),r.use_count,r.tie,r.source_id) as domain_rank
      from remainder r where r.domain<>'1A' or r.code_rank<=r.code_count-remain
    ), slots as (
      select b.domain,max(b.quota)-count(a.source_id) needed from private.generated_mcq_blueprint() b
        join pg_temp.generated_mcq_pool p on p.competency_code=b.code
        join pg_temp.generated_mcq_picks a on a.source_id=p.source_id group by b.domain
    )
    insert into pg_temp.generated_mcq_picks
      select r.source_id from domain_ranks r join slots s on s.domain=r.domain where r.domain_rank<=s.needed;
    select count(*) into n from pg_temp.generated_mcq_picks;
    if n<>200 then raise exception 'Insufficient eligible items for generated form % (% of 200)',fn,n; end if;
    insert into private.generated_mcq_forms(form_number,title,sampler_seed,original_reference_form_id)
      values(fn,'Additional timed practice '||fn,p_seed,p_original_form) returning id into form_key;
    insert into private.generated_mcq_form_items(form_id,position,source_kind,source_id,domain,competency_code,stem,
      options,correct_index,option_rationales,reference_titles)
      select form_key,row_number() over(order by md5(p_seed||':order:'||fn||':'||p.source_id),p.source_id),
        p.source_kind,p.source_id,p.domain,p.competency_code,p.stem,p.options,p.correct_index,p.option_rationales,p.reference_titles
      from pg_temp.generated_mcq_picks a join pg_temp.generated_mcq_pool p on p.source_id=a.source_id;
    insert into pg_temp.generated_mcq_seen as prior(source_id,uses)
      select a.source_id,1 from pg_temp.generated_mcq_picks a
      on conflict(source_id) do update set uses=prior.uses+1;
    return query select form_key,fn;
  end loop;
end
$$;

create function private.generated_mcq_options(item_id uuid, choices text[])
returns jsonb language sql immutable strict set search_path='' as $$
  select jsonb_agg(jsonb_build_object('id',md5('generated:'||item_id::text||':'||o.n::text),'text',o.choice) order by o.n)
  from unnest(choices) with ordinality o(choice,n)
$$;

create function public.website_generated_mcq_mock_action(
  p_user_id uuid,p_action text,p_form_id uuid default null,p_attempt_id uuid default null,
  p_answers jsonb default '[]',p_flags jsonb default '[]',p_compact boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  t timestamptz;
  f private.generated_mcq_forms%rowtype;
  a private.generated_mcq_attempts%rowtype;
  active_form uuid;
  response jsonb;
  data jsonb;
  submitted_answers jsonb;
  submitted_flags uuid[];
  matched_answers int;
  matched_flags int;
  correct_count int;
  wrong_count int;
  unanswered_count int;
  label text:=private.generated_mcq_disclaimer();
begin
  if p_user_id is null or p_action is null or p_action not in ('catalog','status','start','save','submit','results') then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid generated mock action.'));
  end if;
  if (p_action='catalog' and (p_form_id is not null or p_attempt_id is not null))
    or (p_action<>'catalog' and p_form_id is null)
    or (p_action in ('save','submit','results') and p_attempt_id is null) then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid form or attempt identifiers.'));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,25195500));
  if not private.mcq_bank_paid_access(p_user_id) then
    return jsonb_build_object('status',403,'body',jsonb_build_object('error','An active paid website MCQ subscription is required.'));
  end if;
  t:=clock_timestamp();
  update private.generated_mcq_attempts set state='expired',finalized_at=expires_at
    where user_id=p_user_id and state='in_progress' and expires_at<=t;
  select g.form_id into active_form from private.generated_mcq_attempts g
    where g.user_id=p_user_id and g.state='in_progress';
  if p_action='catalog' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'form_id',g.id,'title',g.title,'number',g.form_number,
      'state',coalesce(r.state,'available'),'attempt_id',r.id,
      'competency_basis',g.competency_basis
    ) order by g.form_number),'[]') into data
    from private.generated_mcq_forms g left join private.generated_mcq_attempts r on r.user_id=p_user_id and r.form_id=g.id
    where g.released_at is not null;
    return jsonb_build_object('status',200,'body',jsonb_build_object(
      'forms',data,'active_form_id',active_form,'disclaimer',label,'server_now',clock_timestamp()));
  end if;
  select * into f from private.generated_mcq_forms g where g.id=p_form_id and g.released_at is not null;
  if not found then return jsonb_build_object('status',404,'body',jsonb_build_object('error','This generated form is unavailable.')); end if;
  if p_attempt_id is not null then
    select * into a from private.generated_mcq_attempts g
      where g.id=p_attempt_id and g.form_id=p_form_id and g.user_id=p_user_id for update;
    if not found then return jsonb_build_object('status',404,'body',jsonb_build_object('error','Attempt not found.')); end if;
  else
    select * into a from private.generated_mcq_attempts g where g.user_id=p_user_id and g.form_id=p_form_id for update;
  end if;
  if a.id is null and p_action='start' then
    if active_form is not null and active_form<>p_form_id then
      return jsonb_build_object('status',409,'body',jsonb_build_object(
        'error','Resume your active additional practice form first.','active_form_id',active_form));
    end if;
    t:=clock_timestamp();
    insert into private.generated_mcq_attempts(user_id,form_id,started_at,expires_at)
      values(p_user_id,p_form_id,t,t+interval '260 minutes') returning * into a;
  end if;
  response:=jsonb_build_object('form_id',f.id,'title',f.title,'number',f.form_number,
    'competency_basis',f.competency_basis,'disclaimer',label);
  if a.id is null then return jsonb_build_object('status',200,'body',
    response||jsonb_build_object('state','available','server_now',clock_timestamp())); end if;

  if a.state='in_progress' and p_action in ('save','submit') then
    if coalesce(jsonb_typeof(p_answers),'null')<>'array' or coalesce(jsonb_typeof(p_flags),'null')<>'array' then
      return jsonb_build_object('status',400,'body',jsonb_build_object('error','Answers and flags must be arrays.'));
    end if;
    if jsonb_array_length(p_answers)>200 or jsonb_array_length(p_flags)>200 then
      return jsonb_build_object('status',400,'body',jsonb_build_object('error','Too many answers or flags.'));
    end if;
    select coalesce(jsonb_object_agg(i.id::text,j.r->>'choice_id'),'{}'),count(distinct i.id)
      into submitted_answers,matched_answers
      from jsonb_array_elements(p_answers) j(r)
      join private.generated_mcq_form_items i on i.form_id=a.form_id and i.id::text=j.r->>'question_id'
      where jsonb_typeof(j.r)='object' and exists(select 1 from generate_series(1,4) o(n)
        where md5('generated:'||i.id::text||':'||o.n::text)=j.r->>'choice_id');
    select coalesce(array_agg(i.id order by i.position),'{}'),count(distinct i.id)
      into submitted_flags,matched_flags
      from jsonb_array_elements_text(p_flags) j(id)
      join private.generated_mcq_form_items i on i.form_id=a.form_id and i.id::text=j.id;
    if matched_answers<>jsonb_array_length(p_answers) or matched_flags<>jsonb_array_length(p_flags) then
      return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid or duplicate answer or flag.'));
    end if;
    t:=clock_timestamp();
    if t>=a.expires_at then
      update private.generated_mcq_attempts set state='expired',finalized_at=a.expires_at where id=a.id returning * into a;
    else
      update private.generated_mcq_attempts set answers=submitted_answers,flags=submitted_flags,
        state=case when p_action='submit' then 'submitted' else 'in_progress' end,
        finalized_at=case when p_action='submit' then t end where id=a.id returning * into a;
    end if;
  end if;
  -- Recheck the DB clock even for navigation/status calls.
  if a.state='in_progress' and clock_timestamp()>=a.expires_at then
    update private.generated_mcq_attempts set state='expired',finalized_at=a.expires_at where id=a.id returning * into a;
  end if;
  response:=response||jsonb_build_object('state',a.state,'server_now',clock_timestamp(),'attempt_id',a.id,
    'started_at',a.started_at,'expires_at',a.expires_at);
  if coalesce(p_compact,false) and p_action='status' then return jsonb_build_object('status',200,'body',response); end if;
  if a.state='in_progress' then
    if p_action='results' then
      return jsonb_build_object('status',409,'body',jsonb_build_object('error','Results unlock after submission or expiry.'));
    end if;
    if p_action in ('status','start') then
      select jsonb_agg(jsonb_build_object('id',i.id,'stem',i.stem,'options',private.generated_mcq_options(i.id,i.options)) order by i.position)
        into data from private.generated_mcq_form_items i where i.form_id=a.form_id;
      response:=response||jsonb_build_object('questions',data);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('question_id',key,'choice_id',value)),'[]')
      into data from jsonb_each_text(a.answers);
    return jsonb_build_object('status',200,'body',response||jsonb_build_object('answers',data,'flags',to_jsonb(a.flags)));
  end if;

  select count(*) filter(where d.selected_id=d.correct_id),
         count(*) filter(where d.selected_id is not null and d.selected_id<>d.correct_id),
         count(*) filter(where d.selected_id is null),
         jsonb_agg(jsonb_build_object(
          'question_id',d.id,'stem',d.stem,'options',private.generated_mcq_options(d.id,d.options),
          'selected_choice_id',d.selected_id,'correct_choice_id',d.correct_id,
          'is_correct',case when d.selected_id is not null then d.selected_id=d.correct_id end,
          'rationale',d.option_rationales[d.correct_index],'correct_rationale',d.option_rationales[d.correct_index],
          'selected_rationale',case when d.selected_id is not null then
            d.option_rationales[(select n from generate_series(1,4) p(n) where md5('generated:'||d.id::text||':'||p.n::text)=d.selected_id)] end,
          'option_rationales',(select jsonb_object_agg(md5('generated:'||d.id::text||':'||r.n::text),r.rationale)
            from unnest(d.option_rationales) with ordinality r(rationale,n)),
          'related_reading_titles',to_jsonb(d.reference_titles)
         ) order by d.position) into correct_count,wrong_count,unanswered_count,data
  from (select i.id,i.position,i.stem,i.options,i.correct_index,i.option_rationales,i.reference_titles,
    a.answers->>i.id::text as selected_id,md5('generated:'||i.id::text||':'||i.correct_index::text) as correct_id
    from private.generated_mcq_form_items i where i.form_id=a.form_id) d;
  return jsonb_build_object('status',200,'body',response||jsonb_build_object('result',jsonb_build_object(
    'correct',correct_count,'wrong',wrong_count,'unanswered',unanswered_count,'total',200,'items',data)));
end
$$;

revoke all on function private.generated_mcq_blueprint(),
  private.generated_mcq_domain(text),private.generated_mcq_stem_key(text),private.generated_mcq_disclaimer(),
  private.generated_mcq_names_safe(text[]),private.generated_mcq_choice_shape(text[],integer,text[]),
  private.generated_mcq_guard_item(),private.generated_mcq_guard_form(),
  private.build_generated_mcq_series(uuid,text,integer),private.generated_mcq_options(uuid,text[])
from public,anon,authenticated,service_role;
revoke all on function public.website_generated_mcq_mock_action(uuid,text,uuid,uuid,jsonb,jsonb,boolean)
from public,anon,authenticated,service_role;
grant execute on function public.website_generated_mcq_mock_action(uuid,text,uuid,uuid,jsonb,jsonb,boolean) to service_role;
notify pgrst,'reload schema';
commit;

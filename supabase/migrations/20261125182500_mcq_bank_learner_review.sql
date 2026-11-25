begin;
-- Server-backed review state scoped to the verified signed-in learner.
-- No option choices, text answers, source files, or rationales are stored here.
create table private.mcq_bank_learner_review (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references private.mcq_bank_items(id) on delete cascade,
  flagged boolean not null default false,
  last_correct boolean,
  primary key(user_id,item_id)
);
create index mcq_bank_review_flagged on private.mcq_bank_learner_review(user_id,item_id) where flagged;
create index mcq_bank_review_wrong on private.mcq_bank_learner_review(user_id,item_id) where last_correct=false;
alter table private.mcq_bank_learner_review enable row level security;
revoke all on private.mcq_bank_learner_review from public,anon,authenticated,service_role;

-- Remove the earlier overload so clients using named arguments resolve one endpoint.
drop function public.website_mcq_bank_action(uuid,text,integer,text,text,integer[],text,text,text,text[]);

create function public.website_mcq_bank_action(
  p_user_id uuid,p_action text,p_module integer default null,p_chapter text default null,
  p_competency text default null,p_planner integer[] default '{}',p_track text default 'single',
  p_after text default null,p_item text default null,p_selected text[] default '{}',
  p_review text default 'all',p_flagged boolean default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare body jsonb;
declare item private.mcq_bank_items%rowtype;
declare ref_names jsonb;
declare correct boolean;
begin
  if p_user_id is null or p_action is null or p_action not in ('status','catalog','list','answer','flag') then
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
      or not coalesce(p_review in ('all','flagged','wrong'),false)
      or (p_module is not null and p_module not between 1 and 14)
      or (p_chapter is not null and p_chapter !~ '^[1-9][0-9]?\.[1-9][0-9]?$')
      or (p_competency is not null and p_competency not in ('1A','1B','2','3','4','5','unclassified')
        and private.mcq_bank_code_domain(p_competency) is null)
      or p_planner is null or cardinality(p_planner)>40 or array_position(p_planner,null) is not null
      or not (0 < all(p_planner) and 161 >= all(p_planner))
      or (p_after is not null and p_after !~ '^NCQ-[1-9][0-9]?\.[1-9][0-9]?-S[0-9]{2}-Q[0-9]{2}$')
    then return jsonb_build_object('status',400,'body',jsonb_build_object('error','Invalid filters.')); end if;
    with matched as materialized (
      select i.id,i.chapter_code,i.kind,i.stem,i.options,i.competency_domain,i.competency_code,i.competency_status,
        coalesce(r.flagged,false) as flagged
      from private.mcq_bank_items i join private.mcq_bank_chapters c on c.code=i.chapter_code
      left join private.mcq_bank_learner_review r on r.user_id=p_user_id and r.item_id=i.id
      where i.released and ((p_track='single')=(i.kind='single'))
        and (p_review='all' or (p_review='flagged' and r.flagged) or (p_review='wrong' and r.last_correct=false))
        and (p_module is null or c.module_number=p_module)
        and (p_chapter is null or c.code=p_chapter)
        and (cardinality(p_planner)=0 or c.planner_chapter_numbers && p_planner)
        and (p_competency is null or i.competency_domain=p_competency or i.competency_code=p_competency
          or (p_competency='unclassified' and i.competency_status='unclassified'))
    ), page as (
      select * from matched where p_after is null or id>p_after order by id limit 13
    ), shown as (
      select id,chapter_code,kind,stem,competency_domain,competency_code,competency_status,flagged,
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
  if p_action='flag' then
    if p_flagged is null then
      return jsonb_build_object('status',400,'body',jsonb_build_object('error','Flag state required.'));
    end if;
    insert into private.mcq_bank_learner_review(user_id,item_id,flagged)
      values(p_user_id,item.id,p_flagged)
      on conflict(user_id,item_id) do update set flagged=excluded.flagged;
    return jsonb_build_object('status',200,'body',jsonb_build_object('id',item.id,'flagged',p_flagged));
  end if;
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
    -- Store only the outcome, never answer choice text or a learner's written response.
    insert into private.mcq_bank_learner_review(user_id,item_id,last_correct)
      values(p_user_id,item.id,correct)
      on conflict(user_id,item_id) do update set last_correct=excluded.last_correct;
    body:=jsonb_build_object('id',item.id,'kind',item.kind,'correct',correct,'correct_option_ids',item.correct_option_ids,
      'option_rationales',item.option_rationales,'reference_titles',ref_names);
  end if;
  return jsonb_build_object('status',200,'body',body);
end
$$;
revoke all on function public.website_mcq_bank_action(uuid,text,integer,text,text,integer[],text,text,text,text[],text,boolean) from public,anon,authenticated;
grant execute on function public.website_mcq_bank_action(uuid,text,integer,text,text,integer[],text,text,text,text[],text,boolean) to service_role;
notify pgrst,'reload schema';
commit;

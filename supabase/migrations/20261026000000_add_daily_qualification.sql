-- RP-M2-02: persisted per-day qualification, without Reward / Wish transitions.
-- Existing domain RPCs lock the plan before changing Items. Internal triggers
-- extend that same transaction; no new client write privilege or execution RPC.
alter table public.daily_plans
  add column total_item_count integer not null default 0,
  add column completed_item_count integer not null default 0,
  add column must_do_item_count integer not null default 0,
  add column completed_must_do_item_count integer not null default 0,
  add column qualification_calculated_at timestamptz,
  add column completion_rate numeric generated always as (
    case when total_item_count = 0 then 0::numeric
      else trunc(100::numeric * completed_item_count / total_item_count, 2) end
  ) stored;

-- Internal only. Explicit owner filtering applies even under SECURITY DEFINER.
create function public.recalculate_daily_qualification(p_plan_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.daily_plans%rowtype;
  v_total integer := 0;
  v_completed integer := 0;
  v_must_do integer := 0;
  v_completed_must_do integer := 0;
  v_qualified boolean := false;
  v_now timestamptz;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'DAILY_PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;
  select plans.* into v_plan from public.daily_plans as plans
  where plans.id = p_plan_id and plans.user_id = p_user_id
  for update;
  -- A cascading owner/plan deletion has no remaining aggregate to update.
  if not found then return; end if;

  if v_plan.status = 'committed' then
    -- Both origins and target types count. Calendar Events have no Daily Item.
    -- Pending/incomplete/cancelled/rescheduled stay in N and are not completed.
    select count(*)::integer,
      count(*) filter (where items.result_status = 'completed')::integer,
      count(*) filter (where items.priority = 'must_do')::integer,
      count(*) filter (where items.priority = 'must_do' and items.result_status = 'completed')::integer
    into v_total, v_completed, v_must_do, v_completed_must_do
    from public.daily_plan_items as items
    where items.daily_plan_id = v_plan.id and items.user_id = p_user_id;
    -- Exact threshold; display truncation must never decide qualification.
    v_qualified := v_total > 0 and v_completed_must_do = v_must_do
      and v_completed::bigint * 100 >= v_total::bigint * 80;
  end if;

  if (v_plan.total_item_count, v_plan.completed_item_count,
      v_plan.must_do_item_count, v_plan.completed_must_do_item_count, v_plan.is_qualified)
    is distinct from (v_total, v_completed, v_must_do, v_completed_must_do, v_qualified)
    or (v_plan.status = 'committed' and v_plan.qualification_calculated_at is null)
    or (v_plan.qualified_at is not null) is distinct from v_qualified
  then
    v_now := clock_timestamp();
    update public.daily_plans as plans set
      total_item_count = v_total, completed_item_count = v_completed,
      must_do_item_count = v_must_do, completed_must_do_item_count = v_completed_must_do,
      is_qualified = v_qualified,
      qualified_at = case when v_qualified then
        case when v_plan.is_qualified then coalesce(v_plan.qualified_at, v_now) else v_now end
        else null end,
      qualification_calculated_at = case when v_plan.status = 'committed' then v_now else null end,
      updated_at = v_now
    where plans.id = v_plan.id and plans.user_id = p_user_id;
  end if;
end;
$$;
revoke all on function public.recalculate_daily_qualification(uuid, uuid)
from public, anon, authenticated;

create function public.refresh_daily_qualification_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Existing Commands never move a Daily Item between plans. If a privileged
  -- maintenance operation does, refresh both affected aggregates.
  if tg_op = 'DELETE' then
    perform public.recalculate_daily_qualification(old.daily_plan_id, old.user_id);
  elsif tg_op = 'INSERT' then
    perform public.recalculate_daily_qualification(new.daily_plan_id, new.user_id);
  else
    if (old.daily_plan_id, old.user_id) is distinct from (new.daily_plan_id, new.user_id) then
      perform public.recalculate_daily_qualification(old.daily_plan_id, old.user_id);
    end if;
    perform public.recalculate_daily_qualification(new.daily_plan_id, new.user_id);
  end if;
  return null;
end;
$$;
revoke all on function public.refresh_daily_qualification_from_item()
from public, anon, authenticated;

create trigger daily_item_qualification_refresh
  after insert or delete or update of result_status, priority, origin, task_id, milestone_id, daily_plan_id, user_id
  on public.daily_plan_items for each row
  execute function public.refresh_daily_qualification_from_item();

create function public.refresh_daily_qualification_from_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recalculate_daily_qualification(new.id, new.user_id);
  return null;
end;
$$;
revoke all on function public.refresh_daily_qualification_from_plan()
from public, anon, authenticated;

-- Status is deliberately the only UPDATE target: aggregate writes cannot recurse.
create trigger daily_plan_qualification_refresh
  after insert or update of status on public.daily_plans for each row
  execute function public.refresh_daily_qualification_from_plan();

-- Initialize from recorded day results, never from the current global Task state.
-- Existing historical snapshots/items are untouched. Newly observed qualified
-- history receives the migration calculation time, not a fabricated earlier time.
do $$
declare v_plan record;
begin
  for v_plan in select id, user_id from public.daily_plans order by id loop
    perform public.recalculate_daily_qualification(v_plan.id, v_plan.user_id);
  end loop;
end;
$$;

alter table public.daily_plans
  add constraint daily_plans_qualification_counts_check check (
    total_item_count >= 0 and completed_item_count between 0 and total_item_count
    and must_do_item_count between 0 and total_item_count
    and completed_must_do_item_count between 0 and must_do_item_count
    and completed_must_do_item_count <= completed_item_count
  ),
  add constraint daily_plans_qualification_truth_check check (
    is_qualified = (status = 'committed' and total_item_count > 0
      and completed_must_do_item_count = must_do_item_count
      and completed_item_count::bigint * 100 >= total_item_count::bigint * 80)
    and (is_qualified = (qualified_at is not null))
  );

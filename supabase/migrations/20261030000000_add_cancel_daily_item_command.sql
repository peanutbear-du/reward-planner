-- RP-M2-05: install command and ACL together; no schema/backfill/table-wide lock.
BEGIN;

create function public.cancel_daily_item(p_date date, p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.daily_plans%rowtype;
  v_item public.daily_plan_items%rowtype;
  v_task_id uuid;
  v_milestone_id uuid;
  v_planning public.planning_items%rowtype;
  v_now timestamptz;
  v_changed boolean := false;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_date is null or p_item_id is null or not isfinite(p_date)
    or p_date < date '0001-01-01' or p_date > date '9999-12-31' then
    raise exception 'INVALID_CANCEL_REQUEST' using errcode = '22023';
  end if;

  -- Cancellation deliberately has no Today/timezone or global Task-state rule.
  select plans.* into v_plan from public.daily_plans as plans
  where plans.user_id = v_user_id and plans.plan_date = p_date for update;
  if not found then raise exception 'DAILY_PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_plan.status <> 'committed' then
    raise exception 'DAILY_PLAN_NOT_COMMITTED' using errcode = 'P0001';
  end if;

  -- Resolve the target only through the owned source Plan/Item. This first read
  -- does not lock the Item: existing Task commands lock Task before Daily Item.
  select items.task_id, items.milestone_id into v_task_id, v_milestone_id
  from public.daily_plan_items as items
  where items.id = p_item_id and items.daily_plan_id = v_plan.id and items.user_id = v_user_id;
  if not found then raise exception 'DAILY_ITEM_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_task_id is not null then
    perform tasks.id from public.tasks as tasks
    where tasks.id = v_task_id and tasks.user_id = v_user_id for update;
    if not found then raise exception 'DAILY_ITEM_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  select items.* into v_item from public.daily_plan_items as items
  where items.id = p_item_id and items.daily_plan_id = v_plan.id and items.user_id = v_user_id for update;
  if not found then raise exception 'DAILY_ITEM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_item.task_id is distinct from v_task_id or v_item.milestone_id is distinct from v_milestone_id then
    raise exception 'DAILY_ITEM_CANCEL_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if v_item.result_status = 'cancelled' then
    -- Retry acknowledges the recorded result. Never touch a newer schedule.
    null;
  elsif v_item.result_status <> 'pending' then
    raise exception 'DAILY_ITEM_CANCEL_NOT_ALLOWED' using errcode = 'P0001';
  else
    -- Task or Milestone targets refer to the same owned Planning relation.
    -- No Milestone entity, execution/reward operation, or global Task write.
    select planning.* into v_planning from public.planning_items as planning
    where planning.user_id = v_user_id and (
      (v_item.task_id is not null and planning.task_id = v_item.task_id)
      or (v_item.milestone_id is not null and planning.milestone_id = v_item.milestone_id)
    ) for update;
    v_now := clock_timestamp();
    if v_planning.id is not null and v_planning.planned_date = p_date then
      update public.planning_items as planning set planned_date = null, updated_at = v_now
      where planning.id = v_planning.id and planning.user_id = v_user_id and planning.planned_date = p_date;
    end if;

    -- Preserve every other historical field. Existing M2-02/M2-03 triggers run
    -- here in this RPC transaction; an error also rolls back the Planning write.
    update public.daily_plan_items as items
    set result_status = 'cancelled', updated_at = v_now
    where items.id = v_item.id and items.user_id = v_user_id and items.daily_plan_id = v_plan.id
    returning items.* into v_item;
    v_changed := true;
  end if;

  return jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'), 'itemId', v_item.id,
    'dailyPlanId', v_plan.id, 'resultStatus', v_item.result_status, 'changed', v_changed
  );
end;
$$;

revoke all on function public.cancel_daily_item(date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_daily_item(date, uuid) to authenticated;

COMMIT;

-- RP-M2-04: install the RPC and its ACL atomically. No table-wide locks,
-- historical backfill, replacement triggers or qualification/reward algorithm.
BEGIN;

create function public.reschedule_task(p_date date, p_task_id uuid, p_target_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_timezone text;
  v_today date;
  v_now timestamptz;
  v_plan public.daily_plans%rowtype;
  v_task public.tasks%rowtype;
  v_item public.daily_plan_items%rowtype;
  v_planning public.planning_items%rowtype;
  v_changed boolean := false;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_date is null or p_task_id is null or p_target_date is null
    or not isfinite(p_date) or not isfinite(p_target_date)
    or p_date < date '0001-01-01' or p_date > date '9999-12-31'
    or p_target_date > date '9999-12-31' or p_target_date <= p_date
  then
    raise exception 'INVALID_RESCHEDULE_DATE' using errcode = '22023';
  end if;

  select settings.timezone into v_timezone from public.user_settings as settings
  where settings.user_id = v_user_id for share;
  v_timezone := coalesce(v_timezone, 'UTC');

  select plans.* into v_plan from public.daily_plans as plans
  where plans.user_id = v_user_id and plans.plan_date = p_date for update;
  if not found then raise exception 'DAILY_PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_plan.status <> 'committed' then
    raise exception 'DAILY_PLAN_NOT_COMMITTED' using errcode = 'P0001';
  end if;

  -- Lock an EXISTING destination before Task/Item/Planning, never afterwards.
  -- Source < destination gives a consistent ascending Plan lock order. This
  -- cannot wait on a target Commit/Draft while holding the Task it needs.
  perform plans.id from public.daily_plans as plans
  where plans.user_id = v_user_id and plans.plan_date = p_target_date for update;

  select tasks.* into v_task from public.tasks as tasks
  where tasks.id = p_task_id and tasks.user_id = v_user_id for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  select items.* into v_item from public.daily_plan_items as items
  where items.daily_plan_id = v_plan.id and items.task_id = v_task.id
    and items.user_id = v_user_id for update;
  if not found then raise exception 'DAILY_ITEM_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_item.result_status = 'rescheduled' then
    if v_item.rescheduled_to_date is distinct from p_target_date then
      raise exception 'TASK_ALREADY_RESCHEDULED' using errcode = 'P0001';
    end if;
    -- Acknowledge recorded history, even after later execution/schedule changes
    -- or the target date has passed. Do not restore an obsolete Planning date.
  else
    if v_task.status <> 'open' or v_task.project_id is not null or v_task.milestone_id is not null then
      raise exception 'TASK_RESCHEDULE_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if v_item.result_status <> 'pending' or v_item.completed_at_on_day is not null
      or v_item.rescheduled_to_date is not null or v_item.milestone_id is not null then
      raise exception 'DAILY_ITEM_RESCHEDULE_NOT_ALLOWED' using errcode = 'P0001';
    end if;

    select planning.* into v_planning from public.planning_items as planning
    where planning.task_id = v_task.id and planning.user_id = v_user_id for update;

    -- Interpret Today after ALL row-lock waits (including Planning). A wait
    -- across midnight must not accept a target that has just become Today.
    v_now := clock_timestamp();
    begin
      v_today := (v_now at time zone v_timezone)::date;
    exception when invalid_parameter_value then
      raise exception 'INVALID_USER_TIMEZONE' using errcode = 'P0001';
    end;
    if p_date > v_today or p_target_date <= v_today then
      raise exception 'INVALID_RESCHEDULE_DATE' using errcode = '22023';
    end if;

    -- Fresh statement after acquiring the Task lock: if a destination Plan was
    -- concurrently created, any already-committed Task membership is now seen.
    -- Draft/Add Later also lock this Task before inserting its membership. A
    -- later insertion waits until this command commits and is a later action.
    if exists (
      select 1 from public.daily_plan_items as items
      join public.daily_plans as plans on plans.id = items.daily_plan_id and plans.user_id = items.user_id
      where items.user_id = v_user_id and items.task_id = v_task.id and plans.plan_date = p_target_date
    ) then
      raise exception 'RESCHEDULE_TARGET_CONFLICT' using errcode = 'P0001';
    end if;

    if v_planning.id is not null then
      -- User-confirmed rule: do not overwrite an intervening schedule.
      if v_planning.planned_date is not null and v_planning.planned_date not in (p_date, p_target_date) then
        raise exception 'RESCHEDULE_PLANNING_CONFLICT' using errcode = 'P0001';
      end if;
      if v_planning.planned_date is distinct from p_target_date then
        update public.planning_items as planning set planned_date = p_target_date, updated_at = v_now
        where planning.id = v_planning.id and planning.user_id = v_user_id;
      end if;
    else
      -- With no live schedule, carry the source's legal snapshotted time pair.
      insert into public.planning_items (user_id, task_id, planned_date, start_time, end_time)
      values (v_user_id, v_task.id, p_target_date, v_item.planned_start_time_snapshot, v_item.planned_end_time_snapshot);
    end if;

    -- Never move/delete the source relation or modify its immutable snapshots.
    -- M2-02/M2-03 triggers run in this RPC transaction; any error rolls back
    -- both this write and Planning changes. No global Task state is changed.
    update public.daily_plan_items as items
    set result_status = 'rescheduled', rescheduled_to_date = p_target_date, updated_at = v_now
    where items.id = v_item.id and items.user_id = v_user_id
    returning items.* into v_item;
    v_changed := true;
  end if;

  return jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'), 'taskId', v_task.id,
    'targetDate', to_char(p_target_date, 'YYYY-MM-DD'),
    'dailyPlanId', v_plan.id, 'itemId', v_item.id,
    'resultStatus', v_item.result_status, 'changed', v_changed
  );
end;
$$;

revoke all on function public.reschedule_task(date, uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.reschedule_task(date, uuid, date) to authenticated;

COMMIT;

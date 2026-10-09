create function public.add_later_today_item(
  p_date date,
  p_task_id uuid,
  p_priority text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.daily_plans%rowtype;
  v_task public.tasks%rowtype;
  v_item public.daily_plan_items%rowtype;
  v_planning public.planning_items%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_date is null or p_task_id is null or p_priority is null
    or p_priority not in ('must_do', 'plan')
  then
    raise exception 'INVALID_ADD_LATER_REQUEST' using errcode = '22023';
  end if;

  -- Serialize with Commit, Draft commands, and concurrent Added Later calls.
  select plans.* into v_plan
  from public.daily_plans as plans
  where plans.user_id = v_user_id and plans.plan_date = p_date
  for update;
  if not found then
    raise exception 'DAILY_PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'committed' then
    raise exception 'DAILY_PLAN_NOT_COMMITTED' using errcode = 'P0001';
  end if;

  select tasks.* into v_task
  from public.tasks as tasks
  where tasks.id = p_task_id and tasks.user_id = v_user_id
  for share;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.status <> 'open' or v_task.project_id is not null
    or v_task.milestone_id is not null
  then
    raise exception 'TASK_NOT_ADDED_LATER_ELIGIBLE' using errcode = 'P0001';
  end if;

  select items.* into v_item
  from public.daily_plan_items as items
  where items.daily_plan_id = v_plan.id and items.task_id = v_task.id
    and items.user_id = v_user_id;

  if found then
    if v_item.origin = 'initial' then
      raise exception 'INITIAL_ITEM_ALREADY_EXISTS' using errcode = 'P0001';
    end if;
    -- Return the original item without rewriting priority, snapshots or dates.
  else
    select planning.* into v_planning
    from public.planning_items as planning
    where planning.task_id = v_task.id and planning.user_id = v_user_id
      and planning.planned_date = p_date
    for share;

    insert into public.daily_plan_items (
      user_id, daily_plan_id, task_id, origin, priority, result_status,
      title_snapshot, planned_start_time_snapshot, planned_end_time_snapshot
    ) values (
      v_user_id, v_plan.id, v_task.id, 'added_later', p_priority, 'pending',
      v_task.title, v_planning.start_time, v_planning.end_time
    ) returning * into v_item;
  end if;

  return jsonb_build_object(
    'dailyPlanId', v_plan.id,
    'item', jsonb_build_object(
      'id', v_item.id, 'taskId', v_item.task_id, 'origin', v_item.origin,
      'priority', v_item.priority, 'resultStatus', v_item.result_status,
      'title', v_item.title_snapshot,
      'plannedStartTime', v_item.planned_start_time_snapshot,
      'plannedEndTime', v_item.planned_end_time_snapshot,
      'completedAtOnDay', v_item.completed_at_on_day,
      'rescheduledToDate', v_item.rescheduled_to_date
    )
  );
end;
$$;

revoke all on function public.add_later_today_item(date, uuid, text)
from public, anon, authenticated;
grant execute on function public.add_later_today_item(date, uuid, text)
to authenticated;

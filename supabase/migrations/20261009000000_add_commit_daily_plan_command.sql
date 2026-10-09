create function public.commit_daily_plan(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.daily_plans%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'INVALID_COMMIT_REQUEST' using errcode = '22023';
  end if;

  -- Shared with Draft upsert/remove: serialize changes to this day's plan.
  select plans.* into v_plan
  from public.daily_plans as plans
  where plans.user_id = v_user_id and plans.plan_date = p_date
  for update;

  if not found then
    raise exception 'DAILY_PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A retry (including a concurrent caller waiting on the plan lock) returns
  -- the original result without touching snapshots or their timestamps.
  if v_plan.status = 'draft' then
    perform items.id
    from public.daily_plan_items as items
    where items.daily_plan_id = v_plan.id and items.user_id = v_user_id
    order by items.id
    for update;

    if not exists (
      select 1 from public.daily_plan_items as items
      where items.daily_plan_id = v_plan.id and items.user_id = v_user_id
        and items.origin = 'initial'
    ) then
      raise exception 'DAILY_PLAN_EMPTY' using errcode = 'P0001';
    end if;

    -- Freeze from one consistent set of current Task / Planning Item rows.
    -- SHARE prevents title/status and existing schedule edits until commit.
    perform tasks.id
    from public.tasks as tasks
    join public.daily_plan_items as items on items.task_id = tasks.id
    where items.daily_plan_id = v_plan.id and items.user_id = v_user_id
      and tasks.user_id = v_user_id
    order by tasks.id
    for share of tasks;

    perform planning.id
    from public.planning_items as planning
    join public.daily_plan_items as items on items.task_id = planning.task_id
    where items.daily_plan_id = v_plan.id and items.user_id = v_user_id
      and planning.user_id = v_user_id
    order by planning.id
    for share of planning;

    -- Reject invalid selections atomically; never silently drop Draft items.
    if exists (
      select 1
      from public.daily_plan_items as items
      left join public.tasks as tasks
        on tasks.id = items.task_id and tasks.user_id = v_user_id
      where items.daily_plan_id = v_plan.id and items.user_id = v_user_id
        and (
          items.origin <> 'initial' or items.milestone_id is not null
          or items.result_status <> 'pending' or tasks.id is null
          or tasks.status <> 'open' or tasks.project_id is not null
          or tasks.milestone_id is not null
        )
    ) then
      raise exception 'DAILY_PLAN_ITEMS_INVALID' using errcode = 'P0001';
    end if;

    update public.daily_plan_items as items
    set title_snapshot = tasks.title,
        planned_start_time_snapshot = planning.start_time,
        planned_end_time_snapshot = planning.end_time,
        updated_at = now()
    from public.tasks as tasks
    left join public.planning_items as planning
      on planning.task_id = tasks.id and planning.user_id = v_user_id
      and planning.planned_date = p_date
    where items.daily_plan_id = v_plan.id and items.user_id = v_user_id
      and items.task_id = tasks.id and tasks.user_id = v_user_id
      and items.origin = 'initial';

    update public.daily_plans as plans
    set status = 'committed', snapshot_created_at = now(), updated_at = now()
    where plans.id = v_plan.id and plans.user_id = v_user_id
    returning plans.* into v_plan;
  end if;

  return jsonb_build_object(
    'date', to_char(v_plan.plan_date, 'YYYY-MM-DD'),
    'dailyPlan', jsonb_build_object(
      'id', v_plan.id, 'status', v_plan.status,
      'snapshotCreatedAt', v_plan.snapshot_created_at
    )
  );
end;
$$;

revoke all on function public.commit_daily_plan(date)
from public, anon, authenticated;
grant execute on function public.commit_daily_plan(date)
to authenticated;

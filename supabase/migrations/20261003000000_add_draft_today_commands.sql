create function public.upsert_draft_today_item(
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
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_date is null or p_task_id is null
    or p_priority is null or p_priority not in ('must_do', 'plan')
  then
    raise exception 'INVALID_DRAFT_REQUEST' using errcode = '22023';
  end if;

  -- The unique user/date constraint and plan lock serialize draft edits.
  -- Any later validation failure rolls back this insert with the whole RPC.
  insert into public.daily_plans (user_id, plan_date, status)
  values (v_user_id, p_date, 'draft')
  on conflict (user_id, plan_date) do nothing;

  select plans.* into v_plan
  from public.daily_plans as plans
  where plans.user_id = v_user_id and plans.plan_date = p_date
  for update;

  if v_plan.status <> 'draft' then
    raise exception 'DAILY_PLAN_ALREADY_COMMITTED' using errcode = 'P0001';
  end if;

  select tasks.* into v_task
  from public.tasks as tasks
  where tasks.id = p_task_id and tasks.user_id = v_user_id
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.status <> 'open' or v_task.project_id is not null
    or v_task.milestone_id is not null
  then
    raise exception 'TASK_NOT_DRAFT_ELIGIBLE' using errcode = 'P0001';
  end if;

  select items.* into v_item
  from public.daily_plan_items as items
  where items.daily_plan_id = v_plan.id and items.task_id = v_task.id
    and items.user_id = v_user_id;

  if found then
    if v_item.origin <> 'initial' then
      raise exception 'DRAFT_ITEM_NOT_INITIAL' using errcode = 'P0001';
    end if;
    update public.daily_plan_items as items
    set priority = p_priority, updated_at = now()
    where items.id = v_item.id and items.user_id = v_user_id
    returning items.* into v_item;
  else
    -- Provisional title only. Commit will freeze the actual Initial Snapshot.
    insert into public.daily_plan_items (
      user_id, daily_plan_id, task_id, origin, priority,
      result_status, title_snapshot
    )
    values (
      v_user_id, v_plan.id, v_task.id, 'initial', p_priority,
      'pending', v_task.title
    )
    returning * into v_item;
  end if;

  return jsonb_build_object(
    'dailyPlanId', v_plan.id,
    'item', jsonb_build_object(
      'id', v_item.id, 'taskId', v_item.task_id,
      'origin', v_item.origin, 'priority', v_item.priority,
      'resultStatus', v_item.result_status
    )
  );
end;
$$;

create function public.remove_draft_today_item(
  p_date date,
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.daily_plans%rowtype;
  v_item public.daily_plan_items%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_date is null or p_task_id is null then
    raise exception 'INVALID_DRAFT_REQUEST' using errcode = '22023';
  end if;

  select plans.* into v_plan
  from public.daily_plans as plans
  where plans.user_id = v_user_id and plans.plan_date = p_date
  for update;

  if not found then
    raise exception 'DRAFT_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'draft' then
    raise exception 'DAILY_PLAN_ALREADY_COMMITTED' using errcode = 'P0001';
  end if;

  select items.* into v_item
  from public.daily_plan_items as items
  where items.daily_plan_id = v_plan.id and items.task_id = p_task_id
    and items.user_id = v_user_id;

  if not found then
    raise exception 'DRAFT_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_item.origin <> 'initial' then
    raise exception 'DRAFT_ITEM_NOT_INITIAL' using errcode = 'P0001';
  end if;

  delete from public.daily_plan_items as items
  where items.id = v_item.id and items.user_id = v_user_id;

  return jsonb_build_object('dailyPlanId', v_plan.id, 'taskId', p_task_id);
end;
$$;

revoke all on function public.upsert_draft_today_item(date, uuid, text)
from public, anon, authenticated;
grant execute on function public.upsert_draft_today_item(date, uuid, text)
to authenticated;

revoke all on function public.remove_draft_today_item(date, uuid)
from public, anon, authenticated;
grant execute on function public.remove_draft_today_item(date, uuid)
to authenticated;

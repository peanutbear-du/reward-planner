-- M2-01: execution only. Qualification and reward are intentionally unchanged.
create function public.set_task_completion(
  p_date date,
  p_task_id uuid,
  p_completed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_timezone text;
  v_plan public.daily_plans%rowtype;
  v_task public.tasks%rowtype;
  v_item public.daily_plan_items%rowtype;
  v_now timestamptz;
  v_date date;
  v_task_status text := case when p_completed then 'completed' else 'open' end;
  v_result_status text := case when p_completed then 'completed' else 'pending' end;
  v_changed boolean;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_date is null or p_task_id is null or p_completed is null then
    raise exception 'INVALID_TASK_EXECUTION_REQUEST' using errcode = '22023';
  end if;

  -- Pin the user's configured timezone for the entire transition.
  select settings.timezone into v_timezone
  from public.user_settings as settings
  where settings.user_id = v_user_id
  for share;
  v_timezone := coalesce(v_timezone, 'UTC');

  -- Same plan-first lock order as Commit / Added Later / Draft commands.
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
  for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;

  select items.* into v_item
  from public.daily_plan_items as items
  where items.daily_plan_id = v_plan.id and items.task_id = v_task.id
    and items.user_id = v_user_id
  for update;
  if not found then
    raise exception 'DAILY_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_item.result_status not in ('pending', 'completed') then
    raise exception 'DAILY_ITEM_EXECUTION_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  -- Check after waiting for locks: an overnight retry cannot rewrite yesterday.
  v_now := clock_timestamp();
  begin
    v_date := (v_now at time zone v_timezone)::date;
  exception when invalid_parameter_value then
    raise exception 'INVALID_USER_TIMEZONE' using errcode = 'P0001';
  end;
  if p_date <> v_date then
    raise exception 'TASK_DATE_NOT_CURRENT' using errcode = 'P0001';
  end if;

  v_changed := v_task.status <> v_task_status or v_item.result_status <> v_result_status;
  if v_task.status <> v_task_status then
    update public.tasks as tasks
    set status = v_task_status,
        completed_at = case when p_completed then v_now else null end,
        updated_at = v_now
    where tasks.id = v_task.id and tasks.user_id = v_user_id
    returning tasks.* into v_task;
  end if;
  if v_item.result_status <> v_result_status then
    -- Only this day's execution fields change. All snapshot fields stay frozen.
    update public.daily_plan_items as items
    set result_status = v_result_status,
        completed_at_on_day = case when p_completed then v_now else null end,
        updated_at = v_now
    where items.id = v_item.id and items.user_id = v_user_id
    returning items.* into v_item;
  end if;

  return jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'), 'changed', v_changed,
    'task', jsonb_build_object(
      'id', v_task.id, 'status', v_task.status,
      'completedAt', v_task.completed_at, 'updatedAt', v_task.updated_at
    ),
    'item', jsonb_build_object(
      'id', v_item.id, 'taskId', v_item.task_id, 'resultStatus', v_item.result_status,
      'completedAtOnDay', v_item.completed_at_on_day
    )
  );
end;
$$;

revoke all on function public.set_task_completion(date, uuid, boolean)
from public, anon, authenticated;
grant execute on function public.set_task_completion(date, uuid, boolean)
to authenticated;

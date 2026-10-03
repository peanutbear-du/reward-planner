create or replace function public.edit_task_title(
  p_task_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := regexp_replace(
    p_title,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  v_task public.tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if p_title is null or v_title = '' then
    raise exception 'INVALID_TASK_TITLE' using errcode = '22023';
  end if;

  select tasks.*
  into v_task
  from public.tasks as tasks
  where tasks.id = p_task_id
    and tasks.user_id = v_user_id
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_task.status <> 'open'
    or v_task.project_id is not null
    or v_task.milestone_id is not null
  then
    raise exception 'TASK_EDIT_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  update public.tasks as tasks
  set
    title = v_title,
    updated_at = now()
  where tasks.id = v_task.id
    and tasks.user_id = v_user_id
  returning tasks.* into v_task;

  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', v_task.id,
      'title', v_task.title,
      'status', v_task.status,
      'completedAt', v_task.completed_at,
      'createdAt', v_task.created_at,
      'updatedAt', v_task.updated_at
    )
  );
end;
$$;

create or replace function public.delete_task(
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select tasks.*
  into v_task
  from public.tasks as tasks
  where tasks.id = p_task_id
    and tasks.user_id = v_user_id
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_task.status <> 'open'
    or v_task.project_id is not null
    or v_task.milestone_id is not null
    or exists (
      select 1
      from public.daily_plan_items as daily_plan_items
      where daily_plan_items.task_id = v_task.id
    )
  then
    raise exception 'TASK_DELETE_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  delete from public.tasks as tasks
  where tasks.id = v_task.id
    and tasks.user_id = v_user_id;

  return jsonb_build_object('taskId', v_task.id);
end;
$$;

revoke all on function public.edit_task_title(uuid, text)
from public, anon, authenticated;

grant execute on function public.edit_task_title(uuid, text)
to authenticated;

revoke all on function public.delete_task(uuid)
from public, anon, authenticated;

grant execute on function public.delete_task(uuid)
to authenticated;

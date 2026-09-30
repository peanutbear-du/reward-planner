create or replace function public.create_task(
  p_title text,
  p_planned_date date,
  p_start_time time without time zone,
  p_end_time time without time zone
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
  v_planning_item public.planning_items%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if p_title is null or v_title = '' then
    raise exception 'INVALID_TASK_TITLE' using errcode = '22023';
  end if;

  if p_planned_date is null
    and (p_start_time is not null or p_end_time is not null)
  then
    raise exception 'SCHEDULE_DATE_REQUIRED' using errcode = '22023';
  end if;

  if p_end_time is not null and p_start_time is null then
    raise exception 'SCHEDULE_START_TIME_REQUIRED' using errcode = '22023';
  end if;

  if p_start_time is not null
    and p_end_time is not null
    and p_end_time <= p_start_time
  then
    raise exception 'SCHEDULE_TIME_ORDER_INVALID' using errcode = '22023';
  end if;

  insert into public.tasks (
    user_id,
    title,
    status,
    project_id,
    milestone_id,
    completed_at
  )
  values (
    v_user_id,
    v_title,
    'open',
    null,
    null,
    null
  )
  returning * into v_task;

  if p_planned_date is not null then
    insert into public.planning_items (
      user_id,
      task_id,
      milestone_id,
      planned_date,
      start_time,
      end_time
    )
    values (
      v_user_id,
      v_task.id,
      null,
      p_planned_date,
      p_start_time,
      p_end_time
    )
    returning * into v_planning_item;
  end if;

  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', v_task.id,
      'title', v_task.title,
      'status', v_task.status,
      'completedAt', v_task.completed_at,
      'createdAt', v_task.created_at,
      'updatedAt', v_task.updated_at
    ),
    'planningItem', case
      when v_planning_item.id is null then null
      else jsonb_build_object(
        'id', v_planning_item.id,
        'taskId', v_planning_item.task_id,
        'plannedDate', to_char(v_planning_item.planned_date, 'YYYY-MM-DD'),
        'startTime', case
          when v_planning_item.start_time is null then null
          else to_char(v_planning_item.start_time, 'HH24:MI')
        end,
        'endTime', case
          when v_planning_item.end_time is null then null
          else to_char(v_planning_item.end_time, 'HH24:MI')
        end,
        'createdAt', v_planning_item.created_at,
        'updatedAt', v_planning_item.updated_at
      )
    end
  );
end;
$$;

revoke all on function public.create_task(
  text,
  date,
  time without time zone,
  time without time zone
) from public, anon, authenticated;

grant execute on function public.create_task(
  text,
  date,
  time without time zone,
  time without time zone
) to authenticated;

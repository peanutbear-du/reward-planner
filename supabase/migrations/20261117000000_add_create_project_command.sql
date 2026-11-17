-- RP-M4-02: create a Project with its first Milestones in one authenticated command.
begin;

create function public.create_project(
  p_title text,
  p_scale text,
  p_milestones jsonb,
  p_deadline date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  -- Match ECMAScript trim() used by the request schema and Create Wish.
  v_trim_chars constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_title text := pg_catalog.btrim(p_title, v_trim_chars);
  v_project public.projects%rowtype;
  v_milestone public.milestones%rowtype;
  v_item jsonb;
  v_position bigint;
  v_count integer;
  v_base_reward integer;
  v_remainder integer;
  v_milestone_title text;
  v_due_date_text text;
  v_due_date date;
  v_created_milestones jsonb[] := array[]::jsonb[];
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if v_title is null or v_title !~ '[^[:space:]]'
    or p_scale is null or p_scale not in ('small', 'medium', 'large', 'major')
    or (p_deadline is not null and p_deadline not between date '0001-01-01' and date '9999-12-31')
    or pg_catalog.jsonb_typeof(p_milestones) is distinct from 'array' then
    raise exception 'INVALID_PROJECT_REQUEST' using errcode = '22023';
  end if;

  v_count := pg_catalog.jsonb_array_length(p_milestones);
  if v_count = 0 then
    raise exception 'INVALID_PROJECT_REQUEST' using errcode = '22023';
  end if;

  insert into public.projects (user_id, title, scale, deadline)
  values (v_user_id, v_title, p_scale, p_deadline)
  returning * into v_project;

  -- The insert trigger snapshots the pool. Use that row for allocation.
  v_base_reward := v_project.reward_pool / v_count;
  v_remainder := v_project.reward_pool % v_count;

  for v_item, v_position in
    select input.milestone, input.position
    from pg_catalog.jsonb_array_elements(p_milestones) with ordinality as input(milestone, position)
    order by input.position
  loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'INVALID_PROJECT_REQUEST' using errcode = '22023';
    end if;

    v_milestone_title := pg_catalog.btrim(v_item->>'title', v_trim_chars);
    if (v_item - array['title', 'dueDate']) <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(v_item->'title') is distinct from 'string'
      or v_milestone_title !~ '[^[:space:]]' then
      raise exception 'INVALID_PROJECT_REQUEST' using errcode = '22023';
    end if;

    v_due_date := null;
    v_due_date_text := v_item->>'dueDate';
    if v_due_date_text is not null then
      if pg_catalog.jsonb_typeof(v_item->'dueDate') <> 'string'
        or v_due_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'INVALID_PROJECT_REQUEST' using errcode = '22023';
      end if;

      begin
        v_due_date := v_due_date_text::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'INVALID_PROJECT_REQUEST' using errcode = '22023';
      end;
    end if;

    insert into public.milestones (user_id, project_id, title, due_date, reward_value)
    values (
      v_user_id, v_project.id, v_milestone_title, v_due_date,
      v_base_reward + case when v_position = v_count then v_remainder else 0 end
    )
    returning * into v_milestone;

    v_created_milestones := pg_catalog.array_append(v_created_milestones, pg_catalog.jsonb_build_object(
      'id', v_milestone.id,
      'projectId', v_milestone.project_id,
      'title', v_milestone.title,
      'status', v_milestone.status,
      'rewardValue', v_milestone.reward_value,
      'dueDate', v_milestone.due_date
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'project', pg_catalog.jsonb_build_object(
      'id', v_project.id,
      'title', v_project.title,
      'status', v_project.status,
      'scale', v_project.scale,
      'rewardPool', v_project.reward_pool,
      'deadline', v_project.deadline,
      'scaleLocked', v_project.scale_locked,
      'createdAt', v_project.created_at,
      'updatedAt', v_project.updated_at
    ),
    'milestones', pg_catalog.to_jsonb(v_created_milestones)
  );
end;
$$;

revoke all on function public.create_project(text, text, jsonb, date)
  from public, anon, authenticated, service_role;
grant execute on function public.create_project(text, text, jsonb, date) to authenticated;

commit;

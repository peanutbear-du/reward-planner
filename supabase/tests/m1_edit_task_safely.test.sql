begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.edit_task_title(uuid,text)'::regprocedure
  ),
  'Edit Task command is security definer'
);

select is(
  (
    select proconfig
    from pg_catalog.pg_proc
    where oid = 'public.edit_task_title(uuid,text)'::regprocedure
  ),
  array['search_path=']::text[],
  'Edit Task command has an empty search_path'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.delete_task(uuid)'::regprocedure
  ),
  'Delete Task command is security definer'
);

select is(
  (
    select proconfig
    from pg_catalog.pg_proc
    where oid = 'public.delete_task(uuid)'::regprocedure
  ),
  array['search_path=']::text[],
  'Delete Task command has an empty search_path'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedures
    cross join lateral aclexplode(
      coalesce(procedures.proacl, acldefault('f', procedures.proowner))
    ) as privileges
    where procedures.oid in (
      'public.edit_task_title(uuid,text)'::regprocedure,
      'public.delete_task(uuid)'::regprocedure
    )
      and privileges.grantee = 0
      and privileges.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute Edit or Delete Task'
);

select ok(
  not has_function_privilege('anon', 'public.edit_task_title(uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.delete_task(uuid)', 'execute'),
  'anon cannot execute Edit or Delete Task'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.edit_task_title(uuid,text)',
    'execute'
  )
    and has_function_privilege(
      'authenticated',
      'public.delete_task(uuid)',
      'execute'
    ),
  'authenticated can execute Edit and Delete Task'
);

set local role anon;
set local request.jwt.claim.sub = '';

select throws_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000001', 'Title') $$,
  '42501',
  null,
  'anon cannot invoke Edit Task'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'anon cannot invoke Delete Task'
);

reset role;

select throws_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000001', 'Title') $$,
  '42501',
  'AUTHENTICATION_REQUIRED',
  'Edit Task requires an authenticated identity'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000001') $$,
  '42501',
  'AUTHENTICATION_REQUIRED',
  'Delete Task requires an authenticated identity'
);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-000000000021', 'm1-edit-task-a@example.test'),
  ('00000000-0000-4000-8000-000000000022', 'm1-edit-task-b@example.test');

insert into public.tasks (
  id,
  user_id,
  title,
  status,
  project_id,
  milestone_id,
  completed_at
)
values
  ('10000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000021', 'Draft original', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000021', 'Committed original', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000021', 'Added original', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000021', 'Completed', 'completed', null, null, now()),
  ('10000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000021', 'Project Task', 'open', '20000000-0000-4000-8000-000000000025', null, null),
  ('10000000-0000-4000-8000-000000000026', '00000000-0000-4000-8000-000000000021', 'Milestone Task', 'open', null, '30000000-0000-4000-8000-000000000026', null),
  ('10000000-0000-4000-8000-000000000027', '00000000-0000-4000-8000-000000000021', 'Delete unreferenced', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000028', '00000000-0000-4000-8000-000000000021', 'Delete scheduled', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000029', '00000000-0000-4000-8000-000000000022', 'User B Task', 'open', null, null, null);

insert into public.planning_items (
  id,
  user_id,
  task_id,
  planned_date,
  start_time,
  end_time
)
values (
  '40000000-0000-4000-8000-000000000028',
  '00000000-0000-4000-8000-000000000021',
  '10000000-0000-4000-8000-000000000028',
  '2026-09-30',
  '09:00',
  '10:00'
);

insert into public.daily_plans (
  id,
  user_id,
  plan_date,
  status,
  snapshot_created_at
)
values
  ('50000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000021', '2026-09-30', 'draft', null),
  ('50000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000021', '2026-09-29', 'committed', now());

insert into public.daily_plan_items (
  id,
  user_id,
  daily_plan_id,
  task_id,
  origin,
  priority,
  title_snapshot,
  planned_start_time_snapshot,
  planned_end_time_snapshot
)
values
  (
    '60000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000021',
    '50000000-0000-4000-8000-000000000021',
    '10000000-0000-4000-8000-000000000021',
    'initial',
    'plan',
    'Draft snapshot',
    '08:00',
    '09:00'
  ),
  (
    '60000000-0000-4000-8000-000000000022',
    '00000000-0000-4000-8000-000000000021',
    '50000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000022',
    'initial',
    'plan',
    'Committed snapshot',
    '10:00',
    '11:00'
  ),
  (
    '60000000-0000-4000-8000-000000000023',
    '00000000-0000-4000-8000-000000000021',
    '50000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000023',
    'added_later',
    'plan',
    'Added Later snapshot',
    '12:00',
    '13:00'
  );

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000021';

select throws_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000021', E' \t\n ') $$,
  '22023',
  'INVALID_TASK_TITLE',
  'Edit Task rejects a blank title'
);

select lives_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000021', '  Draft updated  ') $$,
  'an open ordinary Draft-referenced Task can be edited'
);

select lives_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000022', 'Committed updated') $$,
  'an open ordinary committed-referenced Task can be edited'
);

select lives_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000023', 'Added updated') $$,
  'an open ordinary Added Later-referenced Task can be edited'
);

select is(
  (select title from public.tasks where id = '10000000-0000-4000-8000-000000000021'),
  'Draft updated'::text,
  'the trimmed title is persisted on the same Draft Task'
);

select is(
  (
    select count(*)
    from public.tasks
    where id = '10000000-0000-4000-8000-000000000021'
  ),
  1::bigint,
  'editing preserves Task identity and does not create a second Task'
);

select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'id', id,
        'title', title_snapshot,
        'start', planned_start_time_snapshot,
        'end', planned_end_time_snapshot
      )
      order by id
    )
    from public.daily_plan_items
  ),
  jsonb_build_array(
    jsonb_build_object(
      'id', '60000000-0000-4000-8000-000000000021',
      'title', 'Draft snapshot',
      'start', '08:00:00',
      'end', '09:00:00'
    ),
    jsonb_build_object(
      'id', '60000000-0000-4000-8000-000000000022',
      'title', 'Committed snapshot',
      'start', '10:00:00',
      'end', '11:00:00'
    ),
    jsonb_build_object(
      'id', '60000000-0000-4000-8000-000000000023',
      'title', 'Added Later snapshot',
      'start', '12:00:00',
      'end', '13:00:00'
    )
  ),
  'Edit Task leaves every Daily title and time snapshot unchanged'
);

select throws_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000024', 'Changed') $$,
  'P0001',
  'TASK_EDIT_NOT_ALLOWED',
  'a completed Task cannot be edited'
);

select throws_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000025', 'Changed') $$,
  'P0001',
  'TASK_EDIT_NOT_ALLOWED',
  'a Project Task cannot be edited'
);

select throws_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000026', 'Changed') $$,
  'P0001',
  'TASK_EDIT_NOT_ALLOWED',
  'a Milestone Task cannot be edited'
);

select throws_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000029', 'Changed') $$,
  'P0002',
  'TASK_NOT_FOUND',
  'User A cannot edit User B Task and receives not found semantics'
);

select lives_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000027') $$,
  'an open unreferenced ordinary Task can be deleted'
);

select is(
  (
    select count(*)
    from public.tasks
    where id = '10000000-0000-4000-8000-000000000027'
  ),
  0::bigint,
  'Delete Task removes the requested Task'
);

select lives_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000028') $$,
  'a Task referenced only by a Planning Item can be deleted'
);

select is(
  (
    select count(*)
    from public.planning_items
    where task_id = '10000000-0000-4000-8000-000000000028'
  ),
  0::bigint,
  'the Planning Item is cascade deleted without an orphan'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000021') $$,
  'P0001',
  'TASK_DELETE_NOT_ALLOWED',
  'a Draft Daily reference blocks hard delete'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000022') $$,
  'P0001',
  'TASK_DELETE_NOT_ALLOWED',
  'a committed initial Daily reference blocks hard delete'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000023') $$,
  'P0001',
  'TASK_DELETE_NOT_ALLOWED',
  'an Added Later Daily reference blocks hard delete'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000024') $$,
  'P0001',
  'TASK_DELETE_NOT_ALLOWED',
  'a completed Task cannot be deleted'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000025') $$,
  'P0001',
  'TASK_DELETE_NOT_ALLOWED',
  'a Project Task cannot be deleted'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000026') $$,
  'P0001',
  'TASK_DELETE_NOT_ALLOWED',
  'a Milestone Task cannot be deleted'
);

select throws_ok(
  $$ select public.delete_task('10000000-0000-4000-8000-000000000029') $$,
  'P0002',
  'TASK_NOT_FOUND',
  'User A cannot delete User B Task and receives not found semantics'
);

select throws_ok(
  $$ update public.tasks set title = 'Direct update' $$,
  '42501',
  null,
  'authenticated still cannot directly update Tasks'
);

select throws_ok(
  $$ delete from public.tasks $$,
  '42501',
  null,
  'authenticated still cannot directly delete Tasks'
);

select throws_ok(
  $$ update public.planning_items set planned_date = '2026-10-01' $$,
  '42501',
  null,
  'authenticated still cannot directly update Planning Items'
);

select throws_ok(
  $$ delete from public.planning_items $$,
  '42501',
  null,
  'authenticated still cannot directly delete Planning Items'
);

select is(
  (
    public.edit_task_title(
      '10000000-0000-4000-8000-000000000021',
      'Response title'
    ) -> 'task' ->> 'id'
  ),
  '10000000-0000-4000-8000-000000000021'::text,
  'Edit Task response preserves the Task id'
);

reset role;

select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in ('tasks', 'planning_items')
      and privilege_type in ('UPDATE', 'DELETE')
  ),
  0::bigint,
  'the migration adds no authenticated table UPDATE or DELETE grants'
);

select * from finish();

rollback;

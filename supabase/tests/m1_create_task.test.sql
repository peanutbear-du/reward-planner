begin;

create extension if not exists pgtap with schema extensions;

select plan(43);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.create_task(text,date,time without time zone,time without time zone)'::regprocedure
      and prosecdef
  ),
  'Create Task command exists and is security definer'
);

select is(
  (
    select proconfig
    from pg_catalog.pg_proc
    where oid = 'public.create_task(text,date,time without time zone,time without time zone)'::regprocedure
  ),
  array['search_path=']::text[],
  'Create Task command has an empty search_path'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedures
    cross join lateral aclexplode(
      coalesce(
        procedures.proacl,
        acldefault('f', procedures.proowner)
      )
    ) as privileges
    where procedures.oid = 'public.create_task(text,date,time without time zone,time without time zone)'::regprocedure
      and privileges.grantee = 0
      and privileges.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute Create Task'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_task(text,date,time without time zone,time without time zone)',
    'execute'
  ),
  'anon cannot execute Create Task'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_task(text,date,time without time zone,time without time zone)',
    'execute'
  ),
  'authenticated can execute Create Task'
);

set local role anon;
set local request.jwt.claim.sub = '';

select throws_ok(
  $$ select public.create_task('Anonymous Task', null, null, null) $$,
  '42501',
  null,
  'anon cannot invoke Create Task'
);

reset role;

select throws_ok(
  $$ select public.create_task('Unauthenticated Task', null, null, null) $$,
  '42501',
  'AUTHENTICATION_REQUIRED',
  'the command rejects a caller without an authenticated user identity'
);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-000000000011', 'm1-create-task-a@example.test'),
  ('00000000-0000-4000-8000-000000000012', 'm1-create-task-b@example.test');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000011';

select throws_ok(
  $$ select public.create_task(E'\t \n', null, null, null) $$,
  '22023',
  'INVALID_TASK_TITLE',
  'the command rejects a blank title'
);

select throws_ok(
  $$ select public.create_task('Missing date', null, '09:00', null) $$,
  '22023',
  'SCHEDULE_DATE_REQUIRED',
  'the command rejects a time without a planned date'
);

select throws_ok(
  $$ select public.create_task('Missing start', '2026-09-29', null, '10:00') $$,
  '22023',
  'SCHEDULE_START_TIME_REQUIRED',
  'the command rejects an end time without a start time'
);

select throws_ok(
  $$ select public.create_task('Invalid order', '2026-09-29', '10:00', '10:00') $$,
  '22023',
  'SCHEDULE_TIME_ORDER_INVALID',
  'the command rejects an end time that is not later than the start time'
);

select lives_ok(
  $$ select public.create_task('  Task only  ', null, null, null) $$,
  'User A can create a Task without a schedule'
);

select is(
  (select count(*) from public.tasks where title = 'Task only'),
  1::bigint,
  'Task-only creation inserts exactly one Task'
);

select is(
  (select title from public.tasks where title = 'Task only'),
  'Task only'::text,
  'the command persists the trimmed title'
);

select ok(
  exists (
    select 1
    from public.tasks
    where title = 'Task only'
      and status = 'open'
      and completed_at is null
      and project_id is null
      and milestone_id is null
  ),
  'the command creates an ordinary open Task without Project or Milestone ownership'
);

select is(
  (
    select count(*)
    from public.planning_items as planning_items
    join public.tasks as tasks on tasks.id = planning_items.task_id
    where tasks.title = 'Task only'
  ),
  0::bigint,
  'Task-only creation does not create a Planning Item'
);

select lives_ok(
  $$ select public.create_task('Date-only Task', '2026-09-29', null, null) $$,
  'User A can create a date-only scheduled Task'
);

select is(
  (
    select count(*)
    from public.planning_items as planning_items
    join public.tasks as tasks on tasks.id = planning_items.task_id
    where tasks.title = 'Date-only Task'
  ),
  1::bigint,
  'date-only creation inserts exactly one Planning Item'
);

select ok(
  exists (
    select 1
    from public.planning_items as planning_items
    join public.tasks as tasks on tasks.id = planning_items.task_id
      and tasks.user_id = planning_items.user_id
    where tasks.title = 'Date-only Task'
      and planning_items.planned_date = '2026-09-29'
      and planning_items.start_time is null
      and planning_items.end_time is null
      and planning_items.milestone_id is null
  ),
  'the date-only Planning Item references the same Task and owner'
);

select lives_ok(
  $$ select public.create_task('Start-only Task', '2026-09-29', '11:00', null) $$,
  'User A can create a scheduled Task with only a start time'
);

select ok(
  exists (
    select 1
    from public.planning_items as planning_items
    join public.tasks as tasks on tasks.id = planning_items.task_id
    where tasks.title = 'Start-only Task'
      and planning_items.start_time = '11:00'
      and planning_items.end_time is null
  ),
  'the start-only Planning Item stores no end time'
);

select lives_ok(
  $$ select public.create_task('Timed Task', '2026-09-29', '13:00', '14:30') $$,
  'User A can create a fully timed scheduled Task'
);

select ok(
  exists (
    select 1
    from public.planning_items as planning_items
    join public.tasks as tasks on tasks.id = planning_items.task_id
    where tasks.title = 'Timed Task'
      and planning_items.start_time = '13:00'
      and planning_items.end_time = '14:30'
  ),
  'the timed Planning Item stores the requested time range'
);

select is(
  (select count(*) from public.daily_plans),
  0::bigint,
  'Create Task does not create a Daily Plan'
);

select is(
  (select count(*) from public.daily_plan_items),
  0::bigint,
  'Create Task does not create a Daily Plan Item'
);

select ok(
  not exists (
    select 1
    from public.tasks
    where user_id <> '00000000-0000-4000-8000-000000000011'
  ),
  'all User A command-created Tasks derive ownership from auth.uid()'
);

select ok(
  not exists (
    select 1
    from public.planning_items
    where user_id <> '00000000-0000-4000-8000-000000000011'
  ),
  'all User A command-created Planning Items derive ownership from auth.uid()'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000012';

select is(
  (select count(*) from public.tasks),
  0::bigint,
  'User B cannot read User A Tasks'
);

select is(
  (select count(*) from public.planning_items),
  0::bigint,
  'User B cannot read User A Planning Items'
);

select lives_ok(
  $$ select public.create_task('User B Task', null, null, null) $$,
  'User B can execute Create Task for their own identity'
);

select is(
  (select count(*) from public.tasks),
  1::bigint,
  'User B sees exactly their own command-created Task'
);

select throws_ok(
  $$ insert into public.tasks (user_id, title) values ('00000000-0000-4000-8000-000000000012', 'Direct insert') $$,
  '42501',
  null,
  'authenticated cannot directly insert Tasks'
);

select throws_ok(
  $$ update public.tasks set title = 'Direct update' $$,
  '42501',
  null,
  'authenticated cannot directly update Tasks'
);

select throws_ok(
  $$ delete from public.tasks $$,
  '42501',
  null,
  'authenticated cannot directly delete Tasks'
);

select throws_ok(
  $$ insert into public.planning_items (user_id, task_id) values ('00000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000012') $$,
  '42501',
  null,
  'authenticated cannot directly insert Planning Items'
);

select throws_ok(
  $$ update public.planning_items set planned_date = '2026-09-30' $$,
  '42501',
  null,
  'authenticated cannot directly update Planning Items'
);

select throws_ok(
  $$ delete from public.planning_items $$,
  '42501',
  null,
  'authenticated cannot directly delete Planning Items'
);

reset role;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000011';

select ok(
  exists (
    select 1
    from public.tasks
    where title = 'User B Task'
      and user_id = '00000000-0000-4000-8000-000000000012'
  ),
  'User B command-created Task has User B ownership'
);

create function public.test_reject_create_task_planning_item()
returns trigger
language plpgsql
as $$
begin
  raise exception 'forced planning insert failure';
end;
$$;

create trigger reject_create_task_planning_item
before insert on public.planning_items
for each row execute function public.test_reject_create_task_planning_item();

select throws_ok(
  $$ select public.create_task('Atomic rollback Task', '2026-09-29', '15:00', null) $$,
  'P0001',
  'forced planning insert failure',
  'a Planning Item failure aborts the command'
);

select is(
  (select count(*) from public.tasks where title = 'Atomic rollback Task'),
  0::bigint,
  'a Planning Item failure rolls back the Task insert'
);

select is(
  (
    select count(*)
    from public.planning_items as planning_items
    join public.tasks as tasks on tasks.id = planning_items.task_id
    where tasks.title = 'Atomic rollback Task'
  ),
  0::bigint,
  'a failed command leaves no Planning Item'
);

drop trigger reject_create_task_planning_item on public.planning_items;
drop function public.test_reject_create_task_planning_item();

select is(
  (
    public.create_task('Response Task', '2026-09-30', '08:00', '09:00')
      -> 'task' ->> 'title'
  ),
  'Response Task'::text,
  'the command response includes the created Task'
);

select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in ('tasks', 'planning_items')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'the migration does not add authenticated direct-write grants'
);

select * from finish();

rollback;

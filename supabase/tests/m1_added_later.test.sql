begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  (select prosecdef and proconfig = array['search_path=']::text[]
   from pg_catalog.pg_proc where oid = 'public.add_later_today_item(date,uuid,text)'::regprocedure),
  'Added Later is SECURITY DEFINER with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.add_later_today_item(date,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.add_later_today_item(date,uuid,text)', 'execute'),
  'only authenticated callers can execute Added Later'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_proc as procedures
    cross join lateral aclexplode(coalesce(procedures.proacl, acldefault('f', procedures.proowner))) as privileges
    where procedures.oid = 'public.add_later_today_item(date,uuid,text)'::regprocedure
      and privileges.grantee = 0 and privileges.privilege_type = 'EXECUTE'
  ), 'PUBLIC has no Added Later EXECUTE privilege'
);
select throws_ok(
  $$ select public.add_later_today_item('2026-10-10', '10000000-0000-4000-8000-000000000081', 'plan') $$,
  '42501', 'AUTHENTICATION_REQUIRED', 'Added Later requires an authenticated identity'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000081', 'm1-later-a@example.test'),
  ('00000000-0000-4000-8000-000000000082', 'm1-later-b@example.test');
insert into public.tasks (id, user_id, title, status, completed_at, project_id, milestone_id) values
  ('10000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000081', 'Initial Task', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000082', '00000000-0000-4000-8000-000000000081', 'Current Later title', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000083', '00000000-0000-4000-8000-000000000081', 'Other-date Later', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000084', '00000000-0000-4000-8000-000000000081', 'Unscheduled Later', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000085', '00000000-0000-4000-8000-000000000081', 'Completed', 'completed', now(), null, null),
  ('10000000-0000-4000-8000-000000000086', '00000000-0000-4000-8000-000000000081', 'Project', 'open', null, '20000000-0000-4000-8000-000000000086', null),
  ('10000000-0000-4000-8000-000000000087', '00000000-0000-4000-8000-000000000081', 'Milestone', 'open', null, null, '30000000-0000-4000-8000-000000000087'),
  ('10000000-0000-4000-8000-000000000088', '00000000-0000-4000-8000-000000000082', 'Other user Task', 'open', null, null, null);
insert into public.planning_items (id, user_id, task_id, planned_date, start_time, end_time) values
  ('40000000-0000-4000-8000-000000000082', '00000000-0000-4000-8000-000000000081', '10000000-0000-4000-8000-000000000082', '2026-10-10', '11:00', '12:00'),
  ('40000000-0000-4000-8000-000000000083', '00000000-0000-4000-8000-000000000081', '10000000-0000-4000-8000-000000000083', '2026-10-11', '13:00', '14:00');
insert into public.daily_plans (id, user_id, plan_date, status, snapshot_created_at) values
  ('50000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000081', '2026-10-10', 'committed', now()),
  ('50000000-0000-4000-8000-000000000082', '00000000-0000-4000-8000-000000000081', '2026-10-11', 'draft', null);
insert into public.daily_plan_items (
  id, user_id, daily_plan_id, task_id, origin, priority, title_snapshot,
  planned_start_time_snapshot, planned_end_time_snapshot
) values (
  '60000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000081',
  '50000000-0000-4000-8000-000000000081', '10000000-0000-4000-8000-000000000081',
  'initial', 'must_do', 'Original Initial title', '09:00', '10:00'
);
create temporary table added_later_baseline as select
  (select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000081') as plan,
  (select to_jsonb(i) from public.daily_plan_items i where id = '60000000-0000-4000-8000-000000000081') as initial_item,
  (select jsonb_agg(to_jsonb(p) order by p.id) from public.planning_items p) as planning;
grant select on added_later_baseline to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000081';
select throws_ok(
  $$ select public.add_later_today_item('2026-10-12', '10000000-0000-4000-8000-000000000082', 'plan') $$,
  'P0002', 'DAILY_PLAN_NOT_FOUND', 'Added Later does not fabricate a nonexistent Plan'
);
select throws_ok(
  $$ select public.add_later_today_item('2026-10-11', '10000000-0000-4000-8000-000000000082', 'plan') $$,
  'P0001', 'DAILY_PLAN_NOT_COMMITTED', 'Draft Plan is rejected'
);
select throws_ok(
  $$ select public.add_later_today_item('2026-10-10', '10000000-0000-4000-8000-000000000081', 'plan') $$,
  'P0001', 'INITIAL_ITEM_ALREADY_EXISTS', 'an Initial Task cannot be duplicated or change origin'
);
select throws_ok(
  $$ select public.add_later_today_item('2026-10-10', '10000000-0000-4000-8000-000000000088', 'plan') $$,
  'P0002', 'TASK_NOT_FOUND', 'User A cannot add User B Task'
);
select throws_ok(
  format('select public.add_later_today_item(%L,%L,%L)', '2026-10-10', id, 'plan'),
  'P0001', 'TASK_NOT_ADDED_LATER_ELIGIBLE', 'completed and Project/Milestone Tasks are rejected'
) from public.tasks where id in (
  '10000000-0000-4000-8000-000000000085',
  '10000000-0000-4000-8000-000000000086',
  '10000000-0000-4000-8000-000000000087'
);
select lives_ok(
  $$ select public.add_later_today_item('2026-10-10', '10000000-0000-4000-8000-000000000082', 'plan') $$,
  'ordinary Task can be added to a committed Plan'
);
select lives_ok(
  $$ select public.add_later_today_item('2026-10-10', '10000000-0000-4000-8000-000000000083', 'must_do') $$,
  'Must-do priority is accepted for Added Later'
);
select lives_ok(
  $$ select public.add_later_today_item('2026-10-10', '10000000-0000-4000-8000-000000000084', 'plan') $$,
  'an unscheduled Task can be added'
);
select is(
  (select jsonb_agg(jsonb_build_object(
    'taskId', task_id, 'title', title_snapshot, 'priority', priority,
    'origin', origin, 'result', result_status,
    'start', planned_start_time_snapshot, 'end', planned_end_time_snapshot
  ) order by task_id) from public.daily_plan_items where origin = 'added_later'),
  jsonb_build_array(
    jsonb_build_object('taskId', '10000000-0000-4000-8000-000000000082', 'title', 'Current Later title',
      'priority', 'plan', 'origin', 'added_later', 'result', 'pending', 'start', '11:00:00', 'end', '12:00:00'),
    jsonb_build_object('taskId', '10000000-0000-4000-8000-000000000083', 'title', 'Other-date Later',
      'priority', 'must_do', 'origin', 'added_later', 'result', 'pending', 'start', null, 'end', null),
    jsonb_build_object('taskId', '10000000-0000-4000-8000-000000000084', 'title', 'Unscheduled Later',
      'priority', 'plan', 'origin', 'added_later', 'result', 'pending', 'start', null, 'end', null)
  ), 'new items freeze current titles and only same-day times with pending result'
);
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000081'),
  (select plan from added_later_baseline), 'Plan status, timestamp and qualification state remain unchanged');
select is((select to_jsonb(i) from public.daily_plan_items i where id = '60000000-0000-4000-8000-000000000081'),
  (select initial_item from added_later_baseline), 'the whole Initial Snapshot row is unchanged');
select is((select jsonb_agg(to_jsonb(p) order by p.id) from public.planning_items p),
  (select planning from added_later_baseline), 'no Planning Item is edited or rescheduled');
select is((select count(*) from public.tasks), 7::bigint, 'no Task copy is created');

create temporary table added_later_retry_baseline as select
  public.add_later_today_item('2026-10-10', '10000000-0000-4000-8000-000000000082', 'plan') as response,
  (select to_jsonb(i) from public.daily_plan_items i where task_id = '10000000-0000-4000-8000-000000000082') as item;
select lives_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000082', 'Changed global Later title') $$,
  'global Task can change after its Added Later snapshot'
);
reset role;
update public.planning_items set planned_date = '2026-10-15', start_time = '17:00', end_time = '18:00'
  where id = '40000000-0000-4000-8000-000000000082';
set local role authenticated;
select is(public.add_later_today_item('2026-10-10', '10000000-0000-4000-8000-000000000082', 'must_do'),
  (select response from added_later_retry_baseline), 'retry returns original priority and snapshots despite global changes');
select is((select to_jsonb(i) from public.daily_plan_items i where task_id = '10000000-0000-4000-8000-000000000082'),
  (select item from added_later_retry_baseline), 'retry does not write any existing item field or timestamp');
select is((select count(*) from public.daily_plan_items where task_id = '10000000-0000-4000-8000-000000000082'),
  1::bigint, 'repeated addition does not duplicate the daily item');

reset role;
select * from finish();
rollback;

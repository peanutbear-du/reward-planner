begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  (select prosecdef and proconfig = array['search_path=']::text[]
   from pg_catalog.pg_proc where oid = 'public.commit_daily_plan(date)'::regprocedure),
  'Commit is SECURITY DEFINER with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.commit_daily_plan(date)', 'execute')
  and not has_function_privilege('anon', 'public.commit_daily_plan(date)', 'execute'),
  'Commit RPC is available only to authenticated callers'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_proc as procedures
    cross join lateral aclexplode(coalesce(procedures.proacl, acldefault('f', procedures.proowner))) as privileges
    where procedures.oid = 'public.commit_daily_plan(date)'::regprocedure
      and privileges.grantee = 0 and privileges.privilege_type = 'EXECUTE'
  ), 'PUBLIC cannot execute Commit'
);
select throws_ok(
  $$ select public.commit_daily_plan('2026-10-09') $$,
  '42501', 'AUTHENTICATION_REQUIRED', 'Commit requires an authenticated identity'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000071', 'm1-commit-a@example.test'),
  ('00000000-0000-4000-8000-000000000072', 'm1-commit-b@example.test');
insert into public.tasks (id, user_id, title, status, completed_at, project_id, milestone_id) values
  ('10000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000071', 'Current Must-do title', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000071', 'Current Plan title', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000073', '00000000-0000-4000-8000-000000000071', 'Unscheduled title', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000074', '00000000-0000-4000-8000-000000000071', 'Completed', 'completed', now(), null, null),
  ('10000000-0000-4000-8000-000000000075', '00000000-0000-4000-8000-000000000071', 'Project', 'open', null, '20000000-0000-4000-8000-000000000075', null),
  ('10000000-0000-4000-8000-000000000076', '00000000-0000-4000-8000-000000000071', 'Milestone', 'open', null, null, '30000000-0000-4000-8000-000000000076');
insert into public.planning_items (id, user_id, task_id, planned_date, start_time, end_time) values
  ('40000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071', '2026-10-09', '09:00', '10:00'),
  ('40000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000072', '2026-10-10', '11:00', '12:00');
insert into public.daily_plans (id, user_id, plan_date) values
  ('50000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000071', '2026-10-09'),
  ('50000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000071', '2026-10-10'),
  ('50000000-0000-4000-8000-000000000074', '00000000-0000-4000-8000-000000000071', '2026-10-11'),
  ('50000000-0000-4000-8000-000000000075', '00000000-0000-4000-8000-000000000071', '2026-10-12'),
  ('50000000-0000-4000-8000-000000000076', '00000000-0000-4000-8000-000000000071', '2026-10-13'),
  ('50000000-0000-4000-8000-000000000077', '00000000-0000-4000-8000-000000000072', '2026-10-14');
insert into public.daily_plan_items (
  id, user_id, daily_plan_id, task_id, priority, title_snapshot,
  planned_start_time_snapshot, planned_end_time_snapshot
) values
  ('60000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000071', '50000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071', 'must_do', 'Stale provisional Must-do', '01:00', '02:00'),
  ('60000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000071', '50000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000072', 'plan', 'Stale provisional Plan', '03:00', '04:00'),
  ('60000000-0000-4000-8000-000000000073', '00000000-0000-4000-8000-000000000071', '50000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000073', 'plan', 'Stale unscheduled copy', '05:00', '06:00'),
  ('60000000-0000-4000-8000-000000000074', '00000000-0000-4000-8000-000000000071', '50000000-0000-4000-8000-000000000074', '10000000-0000-4000-8000-000000000074', 'plan', 'Invalid provisional', null, null),
  ('60000000-0000-4000-8000-000000000075', '00000000-0000-4000-8000-000000000071', '50000000-0000-4000-8000-000000000075', '10000000-0000-4000-8000-000000000075', 'plan', 'Invalid provisional', null, null),
  ('60000000-0000-4000-8000-000000000076', '00000000-0000-4000-8000-000000000071', '50000000-0000-4000-8000-000000000076', '10000000-0000-4000-8000-000000000076', 'plan', 'Invalid provisional', null, null),
  ('60000000-0000-4000-8000-000000000078', '00000000-0000-4000-8000-000000000071', '50000000-0000-4000-8000-000000000074', '10000000-0000-4000-8000-000000000071', 'must_do', 'Mixed plan valid provisional', null, null);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000071';
select throws_ok(
  $$ select public.commit_daily_plan('2026-10-08') $$,
  'P0002', 'DAILY_PLAN_NOT_FOUND', 'a nonexistent Draft is rejected'
);
select throws_ok(
  $$ select public.commit_daily_plan('2026-10-10') $$,
  'P0001', 'DAILY_PLAN_EMPTY', 'an empty Draft is rejected'
);
select throws_ok(
  $$ select public.commit_daily_plan('2026-10-14') $$,
  'P0002', 'DAILY_PLAN_NOT_FOUND', 'User A cannot commit User B Plan'
);
select throws_ok(
  format('select public.commit_daily_plan(%L)', plan_date),
  'P0001', 'DAILY_PLAN_ITEMS_INVALID', 'invalid Task selection rejects the whole commit'
) from public.daily_plans where plan_date between '2026-10-11' and '2026-10-13';
select ok(
  not exists (select 1 from public.daily_plans where status <> 'draft' or snapshot_created_at is not null),
  'rejected plans remain Draft and unsnapshotted'
);
select is(
  (select title_snapshot from public.daily_plan_items where id = '60000000-0000-4000-8000-000000000078'),
  'Mixed plan valid provisional', 'an invalid mixed selection never partially freezes valid items'
);
select lives_ok(
  $$ select public.commit_daily_plan('2026-10-09') $$,
  'a valid Draft is committed'
);
select ok(
  exists (select 1 from public.daily_plans where id = '50000000-0000-4000-8000-000000000071'
    and status = 'committed' and snapshot_created_at is not null
    and not is_qualified and qualified_at is null),
  'Commit changes status and snapshot timestamp without qualification'
);
select is(
  (select jsonb_agg(jsonb_build_object(
    'id', items.id, 'taskId', items.task_id, 'title', items.title_snapshot,
    'start', items.planned_start_time_snapshot, 'end', items.planned_end_time_snapshot,
    'priority', items.priority, 'origin', items.origin
  ) order by items.id) from public.daily_plan_items as items
   where items.daily_plan_id = '50000000-0000-4000-8000-000000000071'),
  jsonb_build_array(
    jsonb_build_object('id', '60000000-0000-4000-8000-000000000071', 'taskId', '10000000-0000-4000-8000-000000000071',
      'title', 'Current Must-do title', 'start', '09:00:00', 'end', '10:00:00', 'priority', 'must_do', 'origin', 'initial'),
    jsonb_build_object('id', '60000000-0000-4000-8000-000000000072', 'taskId', '10000000-0000-4000-8000-000000000072',
      'title', 'Current Plan title', 'start', null, 'end', null, 'priority', 'plan', 'origin', 'initial'),
    jsonb_build_object('id', '60000000-0000-4000-8000-000000000073', 'taskId', '10000000-0000-4000-8000-000000000073',
      'title', 'Unscheduled title', 'start', null, 'end', null, 'priority', 'plan', 'origin', 'initial')
  ), 'all items freeze current titles and only same-day times, preserving identities and priorities'
);
select is((select count(*) from public.tasks), 6::bigint, 'Commit does not duplicate Tasks');
select is((select count(*) from public.daily_plan_items where daily_plan_id = '50000000-0000-4000-8000-000000000071'),
  3::bigint, 'Commit does not duplicate Daily items');

create temporary table committed_baseline as select
  public.commit_daily_plan('2026-10-09') as response,
  (select jsonb_agg(to_jsonb(i) order by i.id) from public.daily_plan_items i
    where daily_plan_id = '50000000-0000-4000-8000-000000000071') as items,
  (select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000071') as plan;
select lives_ok(
  $$ select public.edit_task_title('10000000-0000-4000-8000-000000000071', 'Changed after Commit') $$,
  'global Task title remains editable after Commit'
);

reset role;
update public.planning_items set planned_date = '2026-10-15', start_time = '18:00', end_time = '19:00'
  where id = '40000000-0000-4000-8000-000000000071';
set local role authenticated;

select is(public.commit_daily_plan('2026-10-09'),
  (select response from committed_baseline), 'retry returns the original response and snapshot timestamp');
select is(
  (select jsonb_agg(to_jsonb(i) order by i.id) from public.daily_plan_items i
    where daily_plan_id = '50000000-0000-4000-8000-000000000071'),
  (select items from committed_baseline), 'retry never refreezes snapshots after global title/schedule changes'
);
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000071'),
  (select plan from committed_baseline), 'retry does not write Plan state or timestamps');
select throws_ok(
  $$ select public.upsert_draft_today_item('2026-10-09', '10000000-0000-4000-8000-000000000071', 'plan') $$,
  'P0001', 'DAILY_PLAN_ALREADY_COMMITTED', 'Draft upsert remains blocked after Commit'
);
select throws_ok(
  $$ select public.remove_draft_today_item('2026-10-09', '10000000-0000-4000-8000-000000000071') $$,
  'P0001', 'DAILY_PLAN_ALREADY_COMMITTED', 'Draft removal remains blocked after Commit'
);

reset role;
select * from finish();
rollback;

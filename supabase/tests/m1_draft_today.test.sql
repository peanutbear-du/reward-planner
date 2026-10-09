begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=']::text[])
   from pg_catalog.pg_proc
   where oid in (
     'public.upsert_draft_today_item(date,uuid,text)'::regprocedure,
     'public.remove_draft_today_item(date,uuid)'::regprocedure
   )),
  'Draft commands use SECURITY DEFINER and an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.upsert_draft_today_item(date,uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.remove_draft_today_item(date,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.upsert_draft_today_item(date,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.remove_draft_today_item(date,uuid)', 'execute'),
  'only authenticated callers can execute the Draft commands'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_proc as procedures
    cross join lateral aclexplode(coalesce(procedures.proacl, acldefault('f', procedures.proowner))) as privileges
    where procedures.oid in (
      'public.upsert_draft_today_item(date,uuid,text)'::regprocedure,
      'public.remove_draft_today_item(date,uuid)'::regprocedure
    ) and privileges.grantee = 0 and privileges.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the Draft commands'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000031', 'm1-draft-a@example.test'),
  ('00000000-0000-4000-8000-000000000032', 'm1-draft-b@example.test');
insert into public.tasks (id, user_id, title, status, completed_at, project_id, milestone_id) values
  ('10000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000031', 'Existing Task', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000032', 'Other user Task', 'open', null, null, null),
  ('10000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000031', 'Completed', 'completed', now(), null, null),
  ('10000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000031', 'Project', 'open', null, '20000000-0000-4000-8000-000000000034', null),
  ('10000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000031', 'Milestone', 'open', null, null, '30000000-0000-4000-8000-000000000035');
insert into public.planning_items (id, user_id, task_id, planned_date, start_time, end_time) values
  ('40000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000031', '2026-10-04', '09:00', '10:00');
insert into public.daily_plans (id, user_id, plan_date, status, snapshot_created_at) values
  ('50000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000031', '2026-10-02', 'committed', now());
insert into public.daily_plan_items (id, user_id, daily_plan_id, task_id, title_snapshot, planned_start_time_snapshot, planned_end_time_snapshot) values
  ('60000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000031', '50000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000031', 'Historical title', '07:00', '08:00');

create temporary table draft_baseline as select
  (select to_jsonb(p) from public.planning_items p where id = '40000000-0000-4000-8000-000000000031') as planning,
  (select to_jsonb(i) from public.daily_plan_items i where id = '60000000-0000-4000-8000-000000000031') as historical,
  (select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000031') as committed_plan;
grant select on draft_baseline to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000031';

select lives_ok(
  $$ select public.upsert_draft_today_item('2026-10-03', '10000000-0000-4000-8000-000000000031', 'must_do') $$,
  'first add creates a Draft with the existing Task'
);
select ok(
  exists (select 1 from public.daily_plans where plan_date = '2026-10-03'
    and status = 'draft' and snapshot_created_at is null and not is_qualified and qualified_at is null),
  'Draft remains unsnapshotted and has no qualification transition'
);
select ok(
  exists (select 1 from public.daily_plan_items as items
    join public.daily_plans as plans on plans.id = items.daily_plan_id
    where plans.plan_date = '2026-10-03' and items.task_id = '10000000-0000-4000-8000-000000000031'
      and items.origin = 'initial' and items.priority = 'must_do'
      and items.result_status = 'pending' and items.title_snapshot = 'Existing Task'
      and items.planned_start_time_snapshot is null and items.planned_end_time_snapshot is null),
  'new item is an initial pending Must-do with a provisional title'
);
create temporary table draft_item_identity as select items.id
  from public.daily_plan_items as items join public.daily_plans as plans on plans.id = items.daily_plan_id
  where plans.plan_date = '2026-10-03';

select lives_ok(
  $$ select public.upsert_draft_today_item('2026-10-03', '10000000-0000-4000-8000-000000000031', 'plan') $$,
  'repeated upsert changes priority'
);
select is(
  (select count(*) from public.daily_plan_items as items
   join public.daily_plans as plans on plans.id = items.daily_plan_id
   where plans.plan_date = '2026-10-03'),
  1::bigint, 'repeat upsert does not duplicate the item'
);
select ok(
  exists (select 1 from public.daily_plan_items where id = (select id from draft_item_identity)
    and priority = 'plan' and title_snapshot = 'Existing Task'),
  'priority update preserves item identity and provisional copy'
);
select is((select count(*) from public.tasks), 4::bigint, 'no second Task is created');

select throws_ok(
  $$ select public.upsert_draft_today_item('2026-10-05', '10000000-0000-4000-8000-000000000032', 'plan') $$,
  'P0002', 'TASK_NOT_FOUND', 'another user Task is hidden and cannot be added'
);
select is((select count(*) from public.daily_plans where plan_date = '2026-10-05'),
  0::bigint, 'failed upsert rolls back first Draft creation');
select throws_ok(
  format('select public.upsert_draft_today_item(%L, %L, %L)', '2026-10-05', id, 'plan'),
  'P0001', 'TASK_NOT_DRAFT_ELIGIBLE', 'completed and Project/Milestone Tasks are ineligible'
)
from public.tasks where id in (
  '10000000-0000-4000-8000-000000000033',
  '10000000-0000-4000-8000-000000000034',
  '10000000-0000-4000-8000-000000000035'
);
select throws_ok(
  $$ select public.upsert_draft_today_item('2026-10-02', '10000000-0000-4000-8000-000000000031', 'must_do') $$,
  'P0001', 'DAILY_PLAN_ALREADY_COMMITTED', 'committed upsert is rejected'
);
select throws_ok(
  $$ select public.remove_draft_today_item('2026-10-02', '10000000-0000-4000-8000-000000000031') $$,
  'P0001', 'DAILY_PLAN_ALREADY_COMMITTED', 'committed removal is rejected'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000032';
select throws_ok(
  $$ select public.remove_draft_today_item('2026-10-03', '10000000-0000-4000-8000-000000000031') $$,
  'P0002', 'DRAFT_ITEM_NOT_FOUND', 'User B cannot remove User A Draft item'
);
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000031';
select lives_ok(
  $$ select public.remove_draft_today_item('2026-10-03', '10000000-0000-4000-8000-000000000031') $$,
  'Draft removal succeeds'
);
select is((select count(*) from public.daily_plans where plan_date = '2026-10-03' and status = 'draft'),
  1::bigint, 'removing the last item retains the empty Draft');
select is((select count(*) from public.daily_plan_items as items
  join public.daily_plans as plans on plans.id = items.daily_plan_id where plans.plan_date = '2026-10-03'),
  0::bigint, 'the last Draft item is removed');
select is((select to_jsonb(p) from public.planning_items p where id = '40000000-0000-4000-8000-000000000031'),
  (select planning from draft_baseline), 'add/remove do not change any Planning Item column');
select is((select to_jsonb(i) from public.daily_plan_items i where id = '60000000-0000-4000-8000-000000000031'),
  (select historical from draft_baseline), 'committed historical snapshot is completely unchanged');
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000031'),
  (select committed_plan from draft_baseline), 'committed plan is completely unchanged');
select is((select count(*) from public.daily_plan_items where origin = 'added_later'),
  0::bigint, 'no Added Later item is created');

reset role;
select * from finish();
rollback;

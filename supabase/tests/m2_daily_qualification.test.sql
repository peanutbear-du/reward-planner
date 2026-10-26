begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- No public recalculation endpoint and no new client table writes.
select ok(not has_function_privilege('authenticated', 'public.recalculate_daily_qualification(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.recalculate_daily_qualification(uuid,uuid)', 'execute'),
  'qualification helper is internal only');
select ok((select prosecdef and proconfig = array['search_path=']::text[] from pg_catalog.pg_proc
  where oid = 'public.recalculate_daily_qualification(uuid,uuid)'::regprocedure),
  'qualification helper uses SECURITY DEFINER and empty search_path');
select ok(not has_table_privilege('authenticated', 'public.daily_plans', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.daily_plan_items', 'UPDATE'),
  'clients cannot write qualification or execution directly');

insert into auth.users (id, email) values
 ('00000000-0000-4000-8000-000000000301', 'm2-qualification-a@example.test'),
 ('00000000-0000-4000-8000-000000000302', 'm2-qualification-b@example.test');
insert into public.user_settings (user_id, timezone) values
 ('00000000-0000-4000-8000-000000000301', 'Pacific/Kiritimati'),
 ('00000000-0000-4000-8000-000000000302', 'UTC');

create temp table fixture_tasks as select i, gen_random_uuid() as id from generate_series(1, 104) i;
insert into public.tasks (id, user_id, title)
select id, '00000000-0000-4000-8000-000000000301', 'Qualification Task ' || i from fixture_tasks;
insert into public.daily_plans (id, user_id, plan_date, status, snapshot_created_at) values
 ('50000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000301', (clock_timestamp() at time zone 'Pacific/Kiritimati')::date, 'committed', now()),
 ('50000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000301', (clock_timestamp() at time zone 'Pacific/Kiritimati')::date - 1, 'committed', now()),
 ('50000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000301', (clock_timestamp() at time zone 'Pacific/Kiritimati')::date + 1, 'draft', null),
 ('50000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000302', (clock_timestamp() at time zone 'UTC')::date, 'committed', now());

select ok((select total_item_count = 0 and completion_rate = 0 and not is_qualified
 and qualified_at is null and qualification_calculated_at is not null
 from public.daily_plans where id = '50000000-0000-4000-8000-000000000301'), 'N=0 cannot qualify');

insert into public.daily_plan_items (user_id, daily_plan_id, task_id, title_snapshot, origin, result_status, completed_at_on_day)
select '00000000-0000-4000-8000-000000000301', '50000000-0000-4000-8000-000000000301', id,
 'Frozen title ' || i, case when i > 90 then 'added_later' else 'initial' end,
 case when i <= 79 then 'completed' else 'pending' end,
 case when i <= 79 then now() else null end from fixture_tasks where i <= 100;
select ok((select total_item_count = 100 and completed_item_count = 79 and completion_rate = 79
 and must_do_item_count = 0 and not is_qualified from public.daily_plans
 where id = '50000000-0000-4000-8000-000000000301'), '79% with no Must-do is not qualified; both origins counted');

insert into public.daily_plan_items (user_id, daily_plan_id, task_id, title_snapshot)
select '00000000-0000-4000-8000-000000000301', p.id, t.id, 'Other date frozen'
from public.daily_plans p cross join fixture_tasks t
where p.id in ('50000000-0000-4000-8000-000000000302', '50000000-0000-4000-8000-000000000303')
 and t.i = case when p.status = 'draft' then 104 else 80 end;
create temp table other_plans as select id, to_jsonb(p) body from public.daily_plans p
where id <> '50000000-0000-4000-8000-000000000301';
create temp table original_items as select id, to_jsonb(i) body from public.daily_plan_items i;
grant select on fixture_tasks, other_plans, original_items to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000301';
select public.set_task_completion((clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 80), true);
select ok((select completed_item_count = 80 and completion_rate = 80 and is_qualified
 and qualified_at is not null from public.daily_plans where id = '50000000-0000-4000-8000-000000000301'),
 '80% with no Must-do qualifies in the execution transaction');
create temp table qualified_state as select to_jsonb(p) body from public.daily_plans p
where id = '50000000-0000-4000-8000-000000000301';
select public.set_task_completion((clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 80), true);
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000301'),
 (select body from qualified_state), 'duplicate Complete preserves qualification and every plan timestamp');
select public.set_task_completion((clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 80), false);
select ok((select not is_qualified and qualified_at is null and completed_item_count = 79 from public.daily_plans
 where id = '50000000-0000-4000-8000-000000000301'), 'Uncomplete reverses qualification and clears qualified_at');
create temp table unqualified_state as select to_jsonb(p) body from public.daily_plans p
where id = '50000000-0000-4000-8000-000000000301';
select public.set_task_completion((clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 80), false);
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000301'),
 (select body from unqualified_state), 'duplicate Uncomplete preserves all plan timestamps');
select public.set_task_completion((clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 80), true);

reset role;
update public.daily_plan_items set priority = 'must_do' where task_id = (select id from fixture_tasks where i = 81)
 and daily_plan_id = '50000000-0000-4000-8000-000000000301';
select ok((select completion_rate = 80 and must_do_item_count = 1 and completed_must_do_item_count = 0
 and not is_qualified from public.daily_plans where id = '50000000-0000-4000-8000-000000000301'),
 'an incomplete current Must-do blocks qualification even at 80%');
set local role authenticated;
select public.set_task_completion((clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 81), true);
select ok((select is_qualified and completed_must_do_item_count = 1 from public.daily_plans
 where id = '50000000-0000-4000-8000-000000000301'), 'all current Must-do completed allows qualification');
select public.set_task_completion((clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 81), false);
reset role;
update public.daily_plan_items set priority = 'plan' where task_id = (select id from fixture_tasks where i = 81)
 and daily_plan_id = '50000000-0000-4000-8000-000000000301';
set local role authenticated;
select public.add_later_today_item((clock_timestamp() at time zone 'Pacific/Kiritimati')::date,
 (select id from fixture_tasks where i = 101), 'plan');
select ok((select total_item_count = 101 and completed_item_count = 80 and completion_rate = 79.20 and not is_qualified
 from public.daily_plans where id = '50000000-0000-4000-8000-000000000301'),
 'Added Later changes denominator and reverses qualification atomically');
create temp table added_state as select to_jsonb(p) body from public.daily_plans p
where id = '50000000-0000-4000-8000-000000000301';
select public.add_later_today_item((clock_timestamp() at time zone 'Pacific/Kiritimati')::date,
 (select id from fixture_tasks where i = 101), 'must_do');
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000301'),
 (select body from added_state), 'Added Later retry neither changes denominator nor priority/timestamps');
select public.set_task_completion((clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 101), true);
select ok((select total_item_count = 101 and completed_item_count = 81 and is_qualified from public.daily_plans
 where id = '50000000-0000-4000-8000-000000000301'), 'Added Later completion contributes to qualification');

select ok(not exists (select 1 from public.daily_plans p join other_plans o using(id) where to_jsonb(p) <> o.body),
 'execution and Added Later preserve other dates and other users');
select ok(not exists (select 1 from public.daily_plan_items i join original_items o using(id)
 where (to_jsonb(i) - array['result_status','completed_at_on_day','updated_at'])
 <> (o.body - array['result_status','completed_at_on_day','updated_at'])),
 'Initial / Added Later identity, title/time snapshots and original priority remain unchanged');
select throws_ok(format('select public.set_task_completion(%L,%L,true)',
 (clock_timestamp() at time zone 'Pacific/Kiritimati')::date - 1, (select id from fixture_tasks where i = 80)),
 'P0001', 'TASK_DATE_NOT_CURRENT', 'historical execution rule is unchanged');

-- Commit/Draft stay distinct; no global Task state is used to qualify a Draft.
select ok((select total_item_count = 0 and not is_qualified and qualification_calculated_at is null
 from public.daily_plans where id = '50000000-0000-4000-8000-000000000303'), 'Draft has no official qualification');
select public.commit_daily_plan((clock_timestamp() at time zone 'Pacific/Kiritimati')::date + 1);
select ok((select total_item_count = 1 and completed_item_count = 0 and not is_qualified
 and qualification_calculated_at is not null from public.daily_plans
 where id = '50000000-0000-4000-8000-000000000303'), 'Commit initializes persisted counts in its own transaction');
select throws_ok(format('select public.set_task_completion(%L,%L,true)',
 (clock_timestamp() at time zone 'Pacific/Kiritimati')::date + 1, (select id from fixture_tasks where i = 104)),
 'P0001', 'TASK_DATE_NOT_CURRENT', 'future execution rule is unchanged');

reset role;
-- A timed Task outside the Daily Plan is schedule context, never denominator.
insert into public.planning_items (user_id, task_id, planned_date, start_time)
select '00000000-0000-4000-8000-000000000301', id, (clock_timestamp() at time zone 'Pacific/Kiritimati')::date, '14:00'
from fixture_tasks where i = 104;
select is((select total_item_count from public.daily_plans where id = '50000000-0000-4000-8000-000000000301'),
 101, 'schedule context without a Daily Item does not enter N');
-- States below are fixture-only; no new cancellation/reschedule command.
insert into public.daily_plan_items (user_id, daily_plan_id, task_id, title_snapshot, result_status)
select '00000000-0000-4000-8000-000000000301', '50000000-0000-4000-8000-000000000301', id,
 'Terminal snapshot', case when i = 102 then 'cancelled' else 'rescheduled' end
from fixture_tasks where i in (102, 103);
select ok((select total_item_count = 103 and completed_item_count = 81 and not is_qualified
 from public.daily_plans where id = '50000000-0000-4000-8000-000000000301'),
 'cancelled/rescheduled Items remain in N and are incomplete');

-- If recalculation fails, Task and Item writes must roll back with it.
create function pg_temp.reject_qualification() returns trigger language plpgsql as $$
begin raise exception 'TEST_QUALIFICATION_FAILURE'; end;
$$;
create trigger m2_qualification_fail before update on public.daily_plans
for each row execute function pg_temp.reject_qualification();
set local role authenticated;
select throws_ok(format('select public.set_task_completion(%L,%L,false)',
 (clock_timestamp() at time zone 'Pacific/Kiritimati')::date, (select id from fixture_tasks where i = 80)),
 'P0001', 'TEST_QUALIFICATION_FAILURE', 'qualification failure rolls back execution');
select ok((select status = 'completed' from public.tasks where id = (select id from fixture_tasks where i = 80))
 and (select result_status = 'completed' from public.daily_plan_items where task_id = (select id from fixture_tasks where i = 80)
 and daily_plan_id = '50000000-0000-4000-8000-000000000301'), 'both execution writes rolled back');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000302';
select is((select count(*)::integer from public.daily_plans where user_id = '00000000-0000-4000-8000-000000000301'),
 0, 'foreign daily qualification is unreadable through RLS');
select throws_ok(format('select public.set_task_completion(%L,%L,true)', (clock_timestamp() at time zone 'UTC')::date,
 (select id from fixture_tasks where i = 80)), 'P0002', 'TASK_NOT_FOUND', 'foreign execution cannot mutate qualification');

select * from finish();
rollback;

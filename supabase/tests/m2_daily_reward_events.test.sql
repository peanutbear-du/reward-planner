-- Run only against a disposable/local database after all migrations.
-- Fixtures, failure-injection triggers and privileged repair simulations rollback.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.reward_events'::regclass), 'ledger has RLS');
select ok(has_table_privilege('authenticated', 'public.reward_events', 'SELECT')
  and not has_table_privilege('anon', 'public.reward_events', 'SELECT'), 'only authenticated reads granted');
select ok(not has_table_privilege(role_name::name, 'public.reward_events', operation), role_name || ' cannot ' || operation || ' rewards')
from (values ('anon'), ('authenticated')) roles(role_name)
cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) operations(operation);
select ok(not has_function_privilege(role_name::name, signature, 'EXECUTE'), role_name || ' cannot call ' || signature)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('public.sync_daily_reward_event(uuid,uuid)'), ('public.refresh_daily_reward_from_plan()')) funcs(signature);
select ok((select prosecdef and array_length(proconfig, 1) = 1
  and proconfig[1] in ('search_path=', 'search_path=""') from pg_proc where oid = signature::regprocedure),
  signature || ' has fixed empty search_path and SECURITY DEFINER')
from (values ('public.sync_daily_reward_event(uuid,uuid)'), ('public.refresh_daily_reward_from_plan()')) funcs(signature);

insert into auth.users (id, email) values
 ('00000000-0000-4000-8000-000000000401', 'm2-reward-a@example.test'),
 ('00000000-0000-4000-8000-000000000402', 'm2-reward-b@example.test');
insert into public.user_settings (user_id, timezone) values
 ('00000000-0000-4000-8000-000000000401', 'UTC'),
 ('00000000-0000-4000-8000-000000000402', 'UTC');
create temp table fixture_tasks as select i, gen_random_uuid() id from generate_series(1,8) i;
insert into public.tasks (id, user_id, title)
select id, case when i = 8 then '00000000-0000-4000-8000-000000000402'::uuid
  else '00000000-0000-4000-8000-000000000401'::uuid end, 'Reward fixture ' || i from fixture_tasks;
insert into public.daily_plans (id, user_id, plan_date, status, snapshot_created_at) values
 ('50000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000401', (clock_timestamp() at time zone 'UTC')::date, 'committed', now()),
 ('50000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000402', (clock_timestamp() at time zone 'UTC')::date, 'committed', now()),
 ('50000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000401', (clock_timestamp() at time zone 'UTC')::date - 10, 'committed', now() - interval '10 days'),
 ('50000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000401', (clock_timestamp() at time zone 'UTC')::date + 1, 'draft', null);
insert into public.daily_plan_items (user_id, daily_plan_id, task_id, title_snapshot)
select '00000000-0000-4000-8000-000000000401', '50000000-0000-4000-8000-000000000401', id, 'Frozen ' || i
from fixture_tasks where i <= 5;
insert into public.daily_plan_items (user_id, daily_plan_id, task_id, title_snapshot) values
 ('00000000-0000-4000-8000-000000000402', '50000000-0000-4000-8000-000000000402', (select id from fixture_tasks where i = 8), 'B frozen'),
 ('00000000-0000-4000-8000-000000000401', '50000000-0000-4000-8000-000000000404', (select id from fixture_tasks where i = 7), 'Draft frozen');
select is((select count(*)::integer from public.reward_events), 0, 'empty, Draft and unqualified days earn nothing');

-- Simulate a qualified day from before M2-03, then call the exact backfill helper.
-- No qualification recomputation, guessed event time or Item mutation is needed.
alter table public.daily_plans disable trigger daily_plan_reward_refresh;
insert into public.daily_plan_items (user_id, daily_plan_id, task_id, title_snapshot, result_status, completed_at_on_day)
select '00000000-0000-4000-8000-000000000401', '50000000-0000-4000-8000-000000000403', id,
 'Historical frozen', 'completed', now() - interval '10 days' from fixture_tasks where i = 1;
update public.daily_plans set qualified_at = now() - interval '10 days'
where id = '50000000-0000-4000-8000-000000000403';
alter table public.daily_plans enable trigger daily_plan_reward_refresh;
create temp table history_before as select to_jsonb(p) body from public.daily_plans p where id = '50000000-0000-4000-8000-000000000403';
create temp table items_before as select id, to_jsonb(i) body from public.daily_plan_items i;
create temp table backfill_start as select clock_timestamp() observed_at;
select public.sync_daily_reward_event('50000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000401');
select ok((select status = 'active' and amount = 1 and created_at >= (select observed_at from backfill_start)
  and created_at > (select qualified_at from public.daily_plans where id = source_id)
  from public.reward_events where source_id = '50000000-0000-4000-8000-000000000403'), 'backfill uses observation time, not historical qualification time');
create temp table history_reward as select to_jsonb(e) body from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000403';
select public.sync_daily_reward_event('50000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000401');
select public.sync_daily_reward_event('50000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000401');
select public.sync_daily_reward_event('50000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000401');
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000403'), (select body from history_reward), 'backfill retry preserves the exact original event');
select is((select count(*)::integer from public.reward_events), 1, 'backfill creates nothing for unqualified or Draft plans');
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000403'), (select body from history_before), 'backfill preserves every persisted historical plan field');
select ok(not exists (select 1 from public.daily_plan_items i join items_before b using(id) where to_jsonb(i) <> b.body), 'backfill preserves all historical Items');

-- An actual ledger error must roll back the whole existing RPC, in both directions.
create function pg_temp.reject_reward_write() returns trigger language plpgsql as $$
begin
  if current_setting('rp_test.fail_reward', true) = 'on' then raise exception 'TEST_REWARD_FAILURE'; end if;
  return new;
end;
$$;
create trigger m2_reward_fail before insert or update on public.reward_events
for each row execute function pg_temp.reject_reward_write();
grant select on fixture_tasks, items_before, history_before, history_reward to authenticated;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000401';
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, id, true) from fixture_tasks where i <= 3 order by i;
select is((select count(*)::integer from public.reward_events where source_id = '50000000-0000-4000-8000-000000000401'), 0, '60% gives no reward');
create temp table before_grant as select to_jsonb(p) body from public.daily_plans p where id = '50000000-0000-4000-8000-000000000401';
set local rp_test.fail_reward = 'on';
select throws_ok(format('select public.set_task_completion(%L,%L,true)', (clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4)),
 'P0001', 'TEST_REWARD_FAILURE', 'grant failure propagates through the execution RPC');
select ok((select status = 'open' and completed_at is null from public.tasks where id = (select id from fixture_tasks where i = 4))
 and (select result_status = 'pending' and completed_at_on_day is null from public.daily_plan_items where task_id = (select id from fixture_tasks where i = 4)), 'failed grant rolls back Task and Item');
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000401'), (select body from before_grant), 'failed grant rolls back all qualification fields and timestamps');
select is((select count(*)::integer from public.reward_events where source_id = '50000000-0000-4000-8000-000000000401'), 0, 'failed grant leaves no event');
set local rp_test.fail_reward = 'off';
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4), true);
create temp table first_event as select * from public.reward_events where source_id = '50000000-0000-4000-8000-000000000401';
select ok((select amount = 1 and status = 'active' and reversed_at is null from first_event), 'first 80% grants active +1');
set local rp_test.fail_reward = 'on';
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4), true);
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 5), true);
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 5), false);
set local rp_test.fail_reward = 'off';
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000401'), (select to_jsonb(f) from first_event f), 'retry and 80/100/80% preserve the exact event');

create temp table before_reverse as select to_jsonb(p) body from public.daily_plans p where id = '50000000-0000-4000-8000-000000000401';
set local rp_test.fail_reward = 'on';
select throws_ok(format('select public.set_task_completion(%L,%L,false)', (clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4)),
 'P0001', 'TEST_REWARD_FAILURE', 'reversal failure propagates');
select ok((select status = 'completed' from public.tasks where id = (select id from fixture_tasks where i = 4))
 and (select result_status = 'completed' from public.daily_plan_items where task_id = (select id from fixture_tasks where i = 4)), 'failed reversal preserves both execution states');
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000401'), (select body from before_reverse), 'failed reversal preserves the whole qualified plan');
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000401'), (select to_jsonb(f) from first_event f), 'failed reversal preserves the active ledger');
set local rp_test.fail_reward = 'off';
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4), false);
select ok((select status = 'reversed' and amount = 1 and reversed_at is not null and id = (select id from first_event) from public.reward_events where source_id = '50000000-0000-4000-8000-000000000401'), 'true to false reverses the original event');
create temp table reversed_event as select to_jsonb(e) body from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000401';
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4), false);
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000401'), (select body from reversed_event), 'false retry preserves reversal time');
set local rp_test.fail_reward = 'on';
select throws_ok(format('select public.set_task_completion(%L,%L,true)', (clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4)),
 'P0001', 'TEST_REWARD_FAILURE', 'reactivation failure aborts execution');
select ok((select not is_qualified and completed_item_count = 3 from public.daily_plans where id = '50000000-0000-4000-8000-000000000401')
 and (select status = 'open' from public.tasks where id = (select id from fixture_tasks where i = 4))
 and (select result_status = 'pending' from public.daily_plan_items where task_id = (select id from fixture_tasks where i = 4)), 'failed reactivation leaves execution and qualification unmodified');
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000401'), (select body from reversed_event), 'failed reactivation leaves the reversed event unchanged');
set local rp_test.fail_reward = 'off';
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4), true);
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000401'), (select to_jsonb(f) from first_event f), 'requalification reuses id and created_at, clears reversal');
select is((select count(*)::integer from public.reward_events where source_id = '50000000-0000-4000-8000-000000000401'), 1, 'one event after all transitions');

-- Added Later must share the qualification / reward transaction as well.
set local rp_test.fail_reward = 'on';
select throws_ok(format('select public.add_later_today_item(%L,%L,%L)', (clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 6), 'plan'),
 'P0001', 'TEST_REWARD_FAILURE', 'Added Later reward reversal failure aborts membership');
select ok(not exists (select 1 from public.daily_plan_items where task_id = (select id from fixture_tasks where i = 6))
 and (select is_qualified and total_item_count = 5 from public.daily_plans where id = '50000000-0000-4000-8000-000000000401'), 'failed Added Later preserves denominator and membership');
set local rp_test.fail_reward = 'off';
select public.add_later_today_item((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 6), 'plan');
select is((select status from public.reward_events where source_id = '50000000-0000-4000-8000-000000000401'), 'reversed', 'Added Later 4/6 reverses reward');
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 6), true);
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000401'), (select to_jsonb(f) from first_event f), 'Added Later completion reactivates original reward');
select ok(not exists (select 1 from public.daily_plan_items i join items_before b using(id)
 where (to_jsonb(i) - array['result_status','completed_at_on_day','updated_at']) <> (b.body - array['result_status','completed_at_on_day','updated_at'])), 'all original Item snapshots remain unchanged');
select is((select to_jsonb(p) from public.daily_plans p where id = '50000000-0000-4000-8000-000000000403'), (select body from history_before), 'current execution never rewrites historical qualification');
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000403'), (select body from history_reward), 'current execution never rewrites historical reward');

select throws_ok($$insert into public.reward_events(user_id,source_type,source_id,amount) values ('00000000-0000-4000-8000-000000000401','DAILY_QUALIFIED','50000000-0000-4000-8000-000000000401',1)$$, '42501', null, 'client cannot insert');
select throws_ok($$update public.reward_events set status = 'reversed', reversed_at = clock_timestamp()$$, '42501', null, 'client cannot update');
select throws_ok($$delete from public.reward_events$$, '42501', null, 'client cannot delete');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000402';
select is((select count(*)::integer from public.reward_events), 0, 'B cannot read A events');
select throws_ok(format('select public.set_task_completion(%L,%L,false)', (clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 4)), 'P0002', 'TASK_NOT_FOUND', 'foreign Task command cannot change A reward');
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, (select id from fixture_tasks where i = 8), true);
select is((select count(*)::integer from public.reward_events), 1, 'B sees only its independently qualified event');
reset role;
set local request.jwt.claim.sub = '';
select is((select to_jsonb(e) from public.reward_events e where source_id = '50000000-0000-4000-8000-000000000401'), (select to_jsonb(f) from first_event f), 'foreign attempts leave A ledger intact');
select throws_ok($$insert into public.reward_events(user_id,source_type,source_id,amount) values ('00000000-0000-4000-8000-000000000401','DAILY_QUALIFIED','50000000-0000-4000-8000-000000000401',1)$$, '23505', null, 'database unique source rejects duplicates');
select throws_ok($$insert into public.reward_events(user_id,source_type,source_id,amount) values ('00000000-0000-4000-8000-000000000402','DAILY_QUALIFIED','50000000-0000-4000-8000-000000000401',1)$$, '23503', null, 'composite FK rejects a foreign source even under privileged writes');
select throws_ok($$update public.reward_events set amount = 2$$, '23514', null, 'Daily reward cannot exceed +1');
select throws_ok($$update public.reward_events set status = 'reversed', reversed_at = null$$, '23514', null, 'reversed reward requires a reversal time');
select throws_ok($$update public.reward_events set source_type = 'MILESTONE_COMPLETED'$$, '23514', null, 'Milestone sources await a future owned-source migration');
select * from finish();
rollback;

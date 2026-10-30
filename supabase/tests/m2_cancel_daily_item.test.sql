-- Disposable/local DB after migrations. No shared Dev/Production failure hooks.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_function_privilege('authenticated','public.cancel_daily_item(date,uuid)','EXECUTE')
 and not has_function_privilege('anon','public.cancel_daily_item(date,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.cancel_daily_item(date,uuid)','EXECUTE'), 'only authenticated RPC access');
select ok((select prosecdef and array_length(proconfig,1)=1 and proconfig[1] in ('search_path=','search_path=""')
 from pg_proc where oid='public.cancel_daily_item(date,uuid)'::regprocedure), 'SECURITY DEFINER with empty search_path');
select ok(not has_table_privilege('authenticated','public.daily_plan_items','UPDATE')
 and not has_table_privilege('authenticated','public.planning_items','UPDATE'), 'no new direct client write path');

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000601','m2-cancel-a@example.test'),
 ('00000000-0000-4000-8000-000000000602','m2-cancel-b@example.test');
insert into public.user_settings(user_id,timezone) values
 ('00000000-0000-4000-8000-000000000601','UTC'),('00000000-0000-4000-8000-000000000602','UTC');
create temp table fixture_tasks as select i,gen_random_uuid() id from generate_series(1,24) i where i<=17 or i>=21;
insert into public.tasks(id,user_id,title,status,completed_at,project_id,milestone_id)
select id,case when i=14 then '00000000-0000-4000-8000-000000000602'::uuid else '00000000-0000-4000-8000-000000000601'::uuid end,
 'Global title '||i,case when i=15 then 'completed' else 'open' end,case when i=15 then now()-interval '1 day' else null end,
 case when i=16 then gen_random_uuid() else null end,case when i=17 then gen_random_uuid() else null end from fixture_tasks;
create temp table fixture_plans(i integer,id uuid,offset_days integer,status text);
insert into fixture_plans values
 (1,'50000000-0000-4000-8000-000000000601',0,'committed'),
 (2,'50000000-0000-4000-8000-000000000602',-7,'committed'),
 (3,'50000000-0000-4000-8000-000000000603',7,'committed'),
 (4,'50000000-0000-4000-8000-000000000604',8,'draft'),
 (5,'50000000-0000-4000-8000-000000000605',0,'committed');
insert into public.daily_plans(id,user_id,plan_date,status,snapshot_created_at)
select id,case when i=5 then '00000000-0000-4000-8000-000000000602'::uuid else '00000000-0000-4000-8000-000000000601'::uuid end,
 (clock_timestamp() at time zone 'UTC')::date+offset_days,status,case when status='committed' then now() else null end from fixture_plans;
create temp table fixture_items as select i,gen_random_uuid() id from fixture_tasks;
insert into public.daily_plan_items(id,user_id,daily_plan_id,task_id,title_snapshot,origin,priority,result_status,completed_at_on_day,rescheduled_to_date,planned_start_time_snapshot,planned_end_time_snapshot)
select f.id,t.user_id,p.id,t.id,'Frozen title '||t2.i,case when t2.i=4 then 'added_later' else 'initial' end,
 case when t2.i in (2,9) then 'must_do' else 'plan' end,
 case when t2.i>=21 or t2.i=5 then 'completed' when t2.i=6 then 'rescheduled' when t2.i=7 then 'incomplete' else 'pending' end,
 case when t2.i>=21 or t2.i=5 then now() else null end,
 case when t2.i=6 then (clock_timestamp() at time zone 'UTC')::date+10 else null end,'09:00','10:00'
from fixture_tasks t2 join public.tasks t on t.id=t2.id join fixture_items f on f.i=t2.i
join fixture_plans p on p.i=case when t2.i=1 or t2.i>=21 then 1 when t2.i in (2,3,4,5,6,7,8,15,16,17) then 2 when t2.i in (9,10,11,12) then 3 when t2.i=13 then 4 else 5 end;
create temp table milestone_fixture as select gen_random_uuid() target,gen_random_uuid() item_id;
insert into public.daily_plan_items(id,user_id,daily_plan_id,milestone_id,title_snapshot)
select item_id,'00000000-0000-4000-8000-000000000601','50000000-0000-4000-8000-000000000603',target,'Milestone relation only' from milestone_fixture;
insert into public.planning_items(user_id,task_id,planned_date,start_time,end_time,target_week)
select '00000000-0000-4000-8000-000000000601',id,
 case when i=8 then null else (clock_timestamp() at time zone 'UTC')::date+case when i=1 then 0 when i=2 then -7 when i=3 then 9 else 7 end end,
 '14:00','15:00',date '2026-09-21' from fixture_tasks where i in (1,2,3,8,9,10);
insert into public.planning_items(user_id,milestone_id,planned_date,start_time,end_time)
select '00000000-0000-4000-8000-000000000601',target,(clock_timestamp() at time zone 'UTC')::date+7,'16:00','17:00' from milestone_fixture;
create temp table original_tasks as select id,to_jsonb(t) body from public.tasks t;
create temp table original_items as select id,to_jsonb(i) body from public.daily_plan_items i;
create temp table original_plans as select id,to_jsonb(p) body from public.daily_plans p;
create temp table original_planning as select id,to_jsonb(p) body from public.planning_items p;
create temp table original_rewards as select id,to_jsonb(e) body from public.reward_events e;
grant select on fixture_tasks,fixture_plans,fixture_items,milestone_fixture,original_tasks,original_items,original_plans,original_planning,original_rewards to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000601';

create temp table first_cancel as select public.cancel_daily_item((clock_timestamp() at time zone 'UTC')::date,(select id from fixture_items where i=1)) body;
select is((select body->>'changed' from first_cancel),'true','first cancellation changes owned current pending Item');
select public.cancel_daily_item((clock_timestamp() at time zone 'UTC')::date-7,id) from fixture_items where i in (2,3,4,8,15,16,17);
select public.cancel_daily_item((clock_timestamp() at time zone 'UTC')::date+7,(select id from fixture_items where i=10));
select ok((select result_status='cancelled' from public.daily_plan_items where id=f.id),'historical/current/future pending Item retained as cancelled') from fixture_items f where i in (1,2,3,4,8,10,15,16,17);
select ok((select planned_date is null and start_time=time '14:00' and end_time=time '15:00' and target_week=date '2026-09-21'
 from public.planning_items where task_id=t.id),'matching date cleared; time/week metadata retained') from fixture_tasks t where i in (1,2,10);
select ok(not exists(select 1 from public.planning_items p join original_planning o using(id)
 where p.task_id in (select id from fixture_tasks where i in (3,8)) and to_jsonb(p)<>o.body),'other-date and null-date Planning rows byte-for-byte unchanged');
select is((select count(*)::integer from public.planning_items where task_id=(select id from fixture_tasks where i=4)),0,'missing Planning is never inserted');
select ok(not exists(select 1 from public.daily_plan_items i join original_items o using(id)
 where (to_jsonb(i)-array['result_status','updated_at'])<>(o.body-array['result_status','updated_at'])),'all other source/history fields remain frozen');
select ok(not exists(select 1 from public.tasks t join original_tasks o using(id) where to_jsonb(t)<>o.body),'every global Task field unchanged, including completed/Project/Milestone-linked Tasks');
select ok(not exists(select 1 from public.daily_plans p join original_plans o using(id) where to_jsonb(p)<>o.body),'all counters, qualification and plan timestamps unchanged');
select ok((select total_item_count=5 and completed_item_count=4 and is_qualified and completion_rate=80 from public.daily_plans where id='50000000-0000-4000-8000-000000000601'),'cancelled Plan Item still yields 4/5 and the same qualification');
select ok((select must_do_item_count=1 and completed_must_do_item_count=0 and not is_qualified from public.daily_plans where id='50000000-0000-4000-8000-000000000602'),'cancelled Must-do remains counted and incomplete');
select ok(not exists(select 1 from public.reward_events e full join original_rewards o using(id) where to_jsonb(e) is distinct from o.body),'no reward creation, reversal, replacement or timestamp change');

create temp table cancelled_rows as select id,to_jsonb(i) body from public.daily_plan_items i where result_status='cancelled';
select is(public.cancel_daily_item((clock_timestamp() at time zone 'UTC')::date,(select id from fixture_items where i=1)),
 (select jsonb_set(body,'{changed}','false') from first_cancel),'repeat returns changed=false');
reset role;
-- Simulate a later arrangement on the original date itself: even this must stay.
update public.planning_items set planned_date=(clock_timestamp() at time zone 'UTC')::date,updated_at=clock_timestamp()
where task_id=(select id from fixture_tasks where i=1);
create temp table later_schedule as select to_jsonb(p) body from public.planning_items p where task_id=(select id from fixture_tasks where i=1);
grant select on later_schedule to authenticated;
create function pg_temp.reject_cancel() returns trigger language plpgsql as $$
begin if new.result_status='cancelled' and current_setting('rp_test.fail_cancel',true)='on' then raise exception 'TEST_CANCEL_FAILURE'; end if; return new; end;
$$;
create trigger m2_cancel_fail before update on public.daily_plan_items for each row execute function pg_temp.reject_cancel();
set local role authenticated;
set local rp_test.fail_cancel='on';
select is(public.cancel_daily_item((clock_timestamp() at time zone 'UTC')::date,(select id from fixture_items where i=1))->>'changed','false','repeat performs no Item write even under failure injection');
select is((select to_jsonb(p) from public.planning_items p where task_id=(select id from fixture_tasks where i=1)),(select body from later_schedule),'repeat never clears a later arrangement, even on original date');
select ok(not exists(select 1 from public.daily_plan_items i join cancelled_rows o using(id) where to_jsonb(i)<>o.body),'repeat preserves every historical Item timestamp');
select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date+7,(select id from fixture_items where i=9)),
 'P0001','TEST_CANCEL_FAILURE','Item write failure aborts prior Planning date cleanup');
select is((select to_jsonb(p) from public.planning_items p where task_id=(select id from fixture_tasks where i=9)),
 (select o.body from original_planning o where o.body->>'task_id'=(select id::text from fixture_tasks where i=9)),'Planning cleanup rolled back');
select is((select to_jsonb(i) from public.daily_plan_items i where id=(select id from fixture_items where i=9)),
 (select body from original_items where id=(select id from fixture_items where i=9)),'failed source Item unchanged');
select ok(not exists(select 1 from public.daily_plans p join original_plans o using(id) where to_jsonb(p)<>o.body),'failure leaves qualification rows unchanged');
select ok(not exists(select 1 from public.reward_events e full join original_rewards o using(id) where to_jsonb(e) is distinct from o.body),'failure leaves reward ledger unchanged');
set local rp_test.fail_cancel='off';

select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date-7,id),
 'P0001','DAILY_ITEM_CANCEL_NOT_ALLOWED','completed/rescheduled/incomplete rejected') from fixture_items where i in (5,6,7);
select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date+8,(select id from fixture_items where i=13)),
 'P0001','DAILY_PLAN_NOT_COMMITTED','Draft uses removal, not cancellation');
select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date,gen_random_uuid()),
 'P0002','DAILY_ITEM_NOT_FOUND','missing Item rejected');
select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_items where i=9)),
 'P0002','DAILY_ITEM_NOT_FOUND','an owned Item from a different date cannot be substituted');
select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date+99,(select id from fixture_items where i=1)),
 'P0002','DAILY_PLAN_NOT_FOUND','missing date rejected');
select throws_ok(format('select public.cancel_daily_item(%L,%L)',invalid_date,(select id from fixture_items where i=1)),
 '22023','INVALID_CANCEL_REQUEST','null/nonfinite dates rejected') from (values(null::date),('infinity'::date)) dates(invalid_date);
select throws_ok(format('select public.cancel_daily_item(%L,null)',(clock_timestamp() at time zone 'UTC')::date),
 '22023','INVALID_CANCEL_REQUEST','null Item identity rejected');
select throws_ok(format('select public.set_task_completion(%L,%L,true)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=1)),
 'P0001','DAILY_ITEM_EXECUTION_NOT_ALLOWED','Complete cannot overwrite cancelled source');
select throws_ok(format('select public.set_task_completion(%L,%L,false)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=1)),
 'P0001','DAILY_ITEM_EXECUTION_NOT_ALLOWED','Uncomplete cannot revive cancelled source');
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=1),(clock_timestamp() at time zone 'UTC')::date+9),
 'P0001','DAILY_ITEM_RESCHEDULE_NOT_ALLOWED','Reschedule cannot overwrite cancelled source');

reset role;
update public.user_settings set timezone='invalid/timezone' where user_id='00000000-0000-4000-8000-000000000601';
set local role authenticated;
select lives_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date+7,(select id from fixture_items where i=9)), 'cancellation does not depend on timezone or Today');
select lives_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date+7,(select item_id from milestone_fixture)), 'owned Milestone-targeted Daily relation cancels without a Milestone execution command');
select ok((select planned_date is null and start_time=time '16:00' and end_time=time '17:00' from public.planning_items where milestone_id=(select target from milestone_fixture)), 'owned Milestone Planning date cleaned with time retained');
select ok(not exists(select 1 from public.daily_plans p join original_plans o using(id) where to_jsonb(p)<>o.body),'Must-do and Milestone-targeted cancellations retain all counters');
select ok(not exists(select 1 from public.reward_events e full join original_rewards o using(id) where to_jsonb(e) is distinct from o.body),'final rewards exactly equal original events');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000602';
select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_items where i=1)),
 'P0002','DAILY_ITEM_NOT_FOUND','foreign Item rejected even with owned same-date Plan');
select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date-7,(select id from fixture_items where i=2)),
 'P0002','DAILY_PLAN_NOT_FOUND','foreign historical Plan rejected');
select is((select count(*)::integer from public.daily_plan_items where user_id='00000000-0000-4000-8000-000000000601'),0,'RLS keeps foreign source rows unreadable');
reset role;
set local request.jwt.claim.sub='';
select throws_ok(format('select public.cancel_daily_item(%L,%L)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_items where i=1)),
 '42501','AUTHENTICATION_REQUIRED','missing authentication rejected even in privileged SQL session');
select * from finish();
rollback;

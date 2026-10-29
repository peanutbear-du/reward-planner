-- Disposable/local database only, after migrations. All fixtures and failure
-- injection are rolled back. Dates follow the real authenticated user's Today;
-- Sep21 -> Sep22 means source Today/history -> a strictly future destination.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_function_privilege('authenticated','public.reschedule_task(date,uuid,date)','EXECUTE')
 and not has_function_privilege('anon','public.reschedule_task(date,uuid,date)','EXECUTE')
 and not has_function_privilege('service_role','public.reschedule_task(date,uuid,date)','EXECUTE'), 'RPC is authenticated only');
select ok((select prosecdef and array_length(proconfig,1) = 1 and proconfig[1] in ('search_path=','search_path=""')
 from pg_proc where oid = 'public.reschedule_task(date,uuid,date)'::regprocedure), 'RPC fixes search_path under SECURITY DEFINER');
select ok(not has_table_privilege('authenticated','public.planning_items','UPDATE')
 and not has_table_privilege('authenticated','public.daily_plan_items','UPDATE'), 'clients still cannot write schedule/history directly');

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000501','m2-reschedule-a@example.test'),
 ('00000000-0000-4000-8000-000000000502','m2-reschedule-b@example.test');
insert into public.user_settings(user_id,timezone) values
 ('00000000-0000-4000-8000-000000000501','UTC'),('00000000-0000-4000-8000-000000000502','UTC');
create temp table fixture_tasks as select i,gen_random_uuid() id from generate_series(1,24) i where i <= 17 or i >= 21;
insert into public.tasks(id,user_id,title,status,completed_at,project_id,milestone_id)
select id,case when i=17 then '00000000-0000-4000-8000-000000000502'::uuid else '00000000-0000-4000-8000-000000000501'::uuid end,
 'Current title '||i,case when i=7 then 'completed' else 'open' end,case when i=7 then now() else null end,
 case when i=8 then gen_random_uuid() else null end,case when i=9 then gen_random_uuid() else null end from fixture_tasks;
create temp table fixture_plans(i integer,id uuid,offset_days integer,status text);
insert into fixture_plans values
 (1,'50000000-0000-4000-8000-000000000501',0,'committed'),
 (2,'50000000-0000-4000-8000-000000000502',-1,'committed'),
 (3,'50000000-0000-4000-8000-000000000503',1,'draft'),
 (4,'50000000-0000-4000-8000-000000000504',2,'committed'),
 (5,'50000000-0000-4000-8000-000000000505',-2,'draft'),
 (6,'50000000-0000-4000-8000-000000000506',3,'committed'),
 (7,'50000000-0000-4000-8000-000000000507',0,'committed');
insert into public.daily_plans(id,user_id,plan_date,status,snapshot_created_at)
select id,case when i=7 then '00000000-0000-4000-8000-000000000502'::uuid else '00000000-0000-4000-8000-000000000501'::uuid end,
 (clock_timestamp() at time zone 'UTC')::date+offset_days,status,case when status='committed' then now() else null end from fixture_plans;
insert into public.daily_plan_items(user_id,daily_plan_id,task_id,title_snapshot,origin,priority,result_status,
 completed_at_on_day,rescheduled_to_date,planned_start_time_snapshot,planned_end_time_snapshot)
select '00000000-0000-4000-8000-000000000501','50000000-0000-4000-8000-000000000502',id,'Frozen title '||i,
 case when i=14 then 'added_later' else 'initial' end,case when i=1 then 'must_do' else 'plan' end,
 case i when 3 then 'completed' when 4 then 'cancelled' when 5 then 'incomplete' when 6 then 'rescheduled' else 'pending' end,
 case when i=3 then now() else null end,case when i=6 then (clock_timestamp() at time zone 'UTC')::date+1 else null end,
 '09:00','10:00' from fixture_tasks where i=1 or i between 3 and 14;
insert into public.daily_plan_items(user_id,daily_plan_id,task_id,title_snapshot,result_status,completed_at_on_day)
select '00000000-0000-4000-8000-000000000501','50000000-0000-4000-8000-000000000501',id,'Today frozen '||i,
 case when i>=21 then 'completed' else 'pending' end,case when i>=21 then now() else null end from fixture_tasks where i=2 or i>=21;
insert into public.daily_plan_items(user_id,daily_plan_id,task_id,title_snapshot)
select case when t.i=17 then '00000000-0000-4000-8000-000000000502'::uuid else '00000000-0000-4000-8000-000000000501'::uuid end,
 p.id,t.id,'Other frozen '||t.i from fixture_tasks t join fixture_plans p on p.i=case t.i when 11 then 3 when 12 then 4 when 15 then 6 when 16 then 5 when 17 then 7 end;
insert into public.planning_items(user_id,task_id,planned_date,start_time,end_time,target_week)
select '00000000-0000-4000-8000-000000000501',id,(clock_timestamp() at time zone 'UTC')::date+case when i=10 then 5 else -1 end,
 '14:00','15:00',date '2026-09-21' from fixture_tasks where i in (1,10,13);
create temp table original_tasks as select id,to_jsonb(t) body from public.tasks t;
create temp table original_items as select id,to_jsonb(i) body from public.daily_plan_items i;
create temp table original_plans as select id,to_jsonb(p) body from public.daily_plans p;
create temp table original_planning as select id,to_jsonb(p) body from public.planning_items p;
create temp table original_reward as select to_jsonb(e) body from public.reward_events e where source_id='50000000-0000-4000-8000-000000000501';
grant select on fixture_tasks,fixture_plans,original_tasks,original_items,original_plans,original_planning,original_reward to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000501';

create temp table first_reschedule as select public.reschedule_task((clock_timestamp() at time zone 'UTC')::date-1,
 (select id from fixture_tasks where i=1),(clock_timestamp() at time zone 'UTC')::date+4) body;
select is((select body->>'changed' from first_reschedule),'true','first historical reschedule changes exactly its source');
select ok((select result_status='rescheduled' and rescheduled_to_date=(clock_timestamp() at time zone 'UTC')::date+4
 from public.daily_plan_items where task_id=(select id from fixture_tasks where i=1)), 'source is retained and marked Rescheduled to target');
select ok((select planned_date=(clock_timestamp() at time zone 'UTC')::date+4 and start_time=time '14:00' and end_time=time '15:00'
 and target_week=date '2026-09-21' from public.planning_items where task_id=(select id from fixture_tasks where i=1)), 'existing live time and week metadata preserved while date moves');
select is((select count(*)::integer from public.daily_plans where plan_date=(clock_timestamp() at time zone 'UTC')::date+4),0,'destination Plan is never fabricated');
select is((select count(*)::integer from public.daily_plan_items where task_id=(select id from fixture_tasks where i=1)),1,'no destination Item or duplicate historical relation');
select is(public.reschedule_task((clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=1),(clock_timestamp() at time zone 'UTC')::date+4),
 (select jsonb_set(body,'{changed}','false') from first_reschedule),'same source/target retry is idempotent');
create temp table after_retry as select to_jsonb(i) body from public.daily_plan_items i where task_id=(select id from fixture_tasks where i=1);
select public.reschedule_task((clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=1),(clock_timestamp() at time zone 'UTC')::date+4);
select is((select to_jsonb(i) from public.daily_plan_items i where task_id=(select id from fixture_tasks where i=1)),(select body from after_retry),'retry preserves original result timestamps');
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=1),(clock_timestamp() at time zone 'UTC')::date+5),
 'P0001','TASK_ALREADY_RESCHEDULED','different target retry safely rejected');

select public.reschedule_task((clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=2),(clock_timestamp() at time zone 'UTC')::date+4);
select ok((select total_item_count=5 and completed_item_count=4 and completion_rate=80 and is_qualified from public.daily_plans where id='50000000-0000-4000-8000-000000000501'), 'rescheduled pending Item stays in denominator; 4/5 remains 80% qualified');
select is((select to_jsonb(e) from public.reward_events e where source_id='50000000-0000-4000-8000-000000000501'),(select body from original_reward),'qualification/reward trigger preserves the existing +1 event without duplication');
select ok(not exists(select 1 from public.daily_plan_items i join original_items o using(id)
 where (to_jsonb(i)-array['result_status','rescheduled_to_date','updated_at'])<>(o.body-array['result_status','rescheduled_to_date','updated_at'])), 'all source/destination snapshots, origin, priority and identity stay unchanged');
select ok(not exists(select 1 from public.daily_plans p join original_plans o using(id) where to_jsonb(p)<>o.body), 'all Plans including destination Draft/Committed remain byte-for-byte unchanged');
select ok(not exists(select 1 from public.tasks t join original_tasks o using(id) where to_jsonb(t)<>o.body)
 and (select count(*) from public.tasks where user_id='00000000-0000-4000-8000-000000000501')=(select count(*) from original_tasks where body->>'user_id'='00000000-0000-4000-8000-000000000501'), 'Task identity/status and Task count unchanged');

select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,id,(clock_timestamp() at time zone 'UTC')::date+4),
 'P0001','DAILY_ITEM_RESCHEDULE_NOT_ALLOWED','completed/cancelled/incomplete source rejected') from fixture_tasks where i in (3,4,5);
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,id,(clock_timestamp() at time zone 'UTC')::date+4),
 'P0001','TASK_RESCHEDULE_NOT_ALLOWED','completed global Task and Project/Milestone Tasks rejected') from fixture_tasks where i in (7,8,9);
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=10),(clock_timestamp() at time zone 'UTC')::date+4),
 'P0001','RESCHEDULE_PLANNING_CONFLICT','intervening schedule is not overwritten');
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,id,(clock_timestamp() at time zone 'UTC')::date+case when i=11 then 1 else 2 end),
 'P0001','RESCHEDULE_TARGET_CONFLICT','same Task already in target Draft/Committed is rejected') from fixture_tasks where i in (11,12);
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-2,(select id from fixture_tasks where i=16),(clock_timestamp() at time zone 'UTC')::date+4),
 'P0001','DAILY_PLAN_NOT_COMMITTED','Draft source rejected');
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date+3,(select id from fixture_tasks where i=15),(clock_timestamp() at time zone 'UTC')::date+4),
 '22023','INVALID_RESCHEDULE_DATE','future source rejected');
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=13),target),
 '22023','INVALID_RESCHEDULE_DATE','Today/past/null/nonfinite targets rejected') from (values ((clock_timestamp() at time zone 'UTC')::date),((clock_timestamp() at time zone 'UTC')::date-1),(null::date),('infinity'::date)) dates(target);
select throws_ok($$select public.reschedule_task(date '2026-09-21',(select id from fixture_tasks where i=13),date '2026-02-30')$$,'22008',null,'invalid calendar date rejected by SQL date parser');

-- Failure occurs AFTER the Planning write inside the same existing RPC.
reset role;
create function pg_temp.reject_reschedule() returns trigger language plpgsql as $$
begin
 if current_setting('rp_test.fail_reschedule',true)='on' and new.result_status='rescheduled' then raise exception 'TEST_RESCHEDULE_FAILURE'; end if;
 return new;
end;
$$;
create trigger m2_reschedule_fail before update on public.daily_plan_items for each row execute function pg_temp.reject_reschedule();
set local role authenticated;
set local rp_test.fail_reschedule='on';
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,id,(clock_timestamp() at time zone 'UTC')::date+4),
 'P0001','TEST_RESCHEDULE_FAILURE','Item failure rolls back existing/new Planning writes') from fixture_tasks where i in (13,14);
select ok((select to_jsonb(p)=o.body from public.planning_items p join original_planning o using(id) where p.task_id=(select id from fixture_tasks where i=13))
 and not exists(select 1 from public.planning_items where task_id=(select id from fixture_tasks where i=14)), 'existing Planning row restored and new Planning insert rolled back');
select ok(not exists(select 1 from public.daily_plan_items i join original_items o using(id) where i.task_id in (select id from fixture_tasks where i in (13,14)) and to_jsonb(i)<>o.body), 'both failed source Items unchanged');
select ok(not exists(select 1 from public.daily_plans p join original_plans o using(id) where to_jsonb(p)<>o.body), 'failure leaves all qualification fields unchanged');
select is((select to_jsonb(e) from public.reward_events e where source_id='50000000-0000-4000-8000-000000000501'),(select body from original_reward),'failure leaves reward unchanged');
set local rp_test.fail_reschedule='off';
select public.reschedule_task((clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=14),(clock_timestamp() at time zone 'UTC')::date+4);
select ok((select start_time=time '09:00' and end_time=time '10:00' from public.planning_items where task_id=(select id from fixture_tasks where i=14)), 'missing Planning row created from legal source snapshot times');

-- Later execution of the same global Task on another day must not rewrite history.
select public.add_later_today_item((clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=1),'plan');
select is((select status from public.reward_events where source_id='50000000-0000-4000-8000-000000000501'),'reversed','existing Added Later qualification/reward reversal remains correct');
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=1),true);
select is((select to_jsonb(e) from public.reward_events e where source_id='50000000-0000-4000-8000-000000000501'),(select body from original_reward),'existing Complete reactivates original reward');
reset role;
update public.planning_items set planned_date=(clock_timestamp() at time zone 'UTC')::date+5 where task_id=(select id from fixture_tasks where i=1);
set local role authenticated;
select is(public.reschedule_task((clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=1),(clock_timestamp() at time zone 'UTC')::date+4)->>'changed','false','old retry acknowledges history even after subsequent global completion');
select ok((select planned_date=(clock_timestamp() at time zone 'UTC')::date+5 from public.planning_items where task_id=(select id from fixture_tasks where i=1)), 'old retry never restores obsolete Planning date');
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=1),false);
select is((select to_jsonb(i) from public.daily_plan_items i where task_id=(select id from fixture_tasks where i=1) and daily_plan_id='50000000-0000-4000-8000-000000000502'),(select body from after_retry),'later Complete/Uncomplete never rewrites original rescheduled history');
select throws_ok(format('select public.set_task_completion(%L,%L,true)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=2)),
 'P0001','DAILY_ITEM_EXECUTION_NOT_ALLOWED','current rescheduled Item cannot be completed');

reset role;
update public.user_settings set timezone='Pacific/Kiritimati' where user_id='00000000-0000-4000-8000-000000000501';
set local role authenticated;
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=13),(clock_timestamp() at time zone 'Pacific/Kiritimati')::date),
 '22023','INVALID_RESCHEDULE_DATE','target checked against configured user Today');
reset role;
update public.user_settings set timezone='invalid/timezone' where user_id='00000000-0000-4000-8000-000000000501';
set local role authenticated;
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=13),(clock_timestamp() at time zone 'UTC')::date+4),
 'P0001','INVALID_USER_TIMEZONE','invalid timezone fails closed');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000502';
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=2),(clock_timestamp() at time zone 'UTC')::date+4),
 'P0002','TASK_NOT_FOUND','foreign Task rejected against owned source date');
select is((select count(*)::integer from public.daily_plan_items where daily_plan_id='50000000-0000-4000-8000-000000000502'),0,'RLS still isolates source history');
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date-1,(select id from fixture_tasks where i=1),(clock_timestamp() at time zone 'UTC')::date+4),
 'P0002','DAILY_PLAN_NOT_FOUND','foreign historical plan not found');
reset role;
set local request.jwt.claim.sub='';
select throws_ok(format('select public.reschedule_task(%L,%L,%L)',(clock_timestamp() at time zone 'UTC')::date,(select id from fixture_tasks where i=2),(clock_timestamp() at time zone 'UTC')::date+4),
 '42501','AUTHENTICATION_REQUIRED','missing auth rejected even for privileged invocation');
select * from finish();
rollback;

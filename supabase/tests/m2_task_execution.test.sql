begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  (select prosecdef and proconfig = array['search_path=']::text[]
   from pg_catalog.pg_proc where oid = 'public.set_task_completion(date,uuid,boolean)'::regprocedure),
  'execution RPC uses SECURITY DEFINER with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.set_task_completion(date,uuid,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.set_task_completion(date,uuid,boolean)', 'execute')
  and not exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.set_task_completion(date,uuid,boolean)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ), 'only authenticated clients can execute the RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.tasks', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.daily_plan_items', 'UPDATE'),
  'clients still cannot write domain tables directly'
);
select throws_ok(
  $$ select public.set_task_completion(current_date, '10000000-0000-4000-8000-000000000201', true) $$,
  '42501', 'AUTHENTICATION_REQUIRED', 'anonymous execution is rejected'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000201', 'm2-execution-a@example.test'),
  ('00000000-0000-4000-8000-000000000202', 'm2-execution-b@example.test');
insert into public.user_settings (user_id, timezone) values
  ('00000000-0000-4000-8000-000000000201', 'Pacific/Kiritimati'),
  ('00000000-0000-4000-8000-000000000202', 'UTC');

insert into public.tasks (id, user_id, title) values
  ('10000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'Current global title'),
  ('10000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000201', 'Added Later'),
  ('10000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000202', 'Foreign Task'),
  ('10000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000201', 'Not in this plan'),
  ('10000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000201', 'Cancelled'),
  ('10000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000201', 'Rescheduled');

insert into public.daily_plans (id, user_id, plan_date, status, snapshot_created_at, is_qualified, qualified_at) values
  ('50000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', (now() at time zone 'Pacific/Kiritimati')::date, 'committed', now(), true, now()),
  ('50000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000201', (now() at time zone 'Pacific/Kiritimati')::date - 1, 'committed', now(), false, null),
  ('50000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000201', (now() at time zone 'Pacific/Kiritimati')::date + 1, 'committed', now(), false, null),
  ('50000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000202', (now() at time zone 'UTC')::date, 'draft', null, false, null);

insert into public.daily_plan_items (
  id, user_id, daily_plan_id, task_id, origin, title_snapshot,
  planned_start_time_snapshot, planned_end_time_snapshot, result_status, completed_at_on_day
) values
  ('60000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', '50000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', 'initial', 'Frozen Initial title', '09:00', '10:00', 'pending', null),
  ('60000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000201', '50000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000202', 'added_later', 'Frozen Later title', '11:00', '12:00', 'pending', null),
  ('60000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000201', '50000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000201', 'initial', 'Yesterday frozen', '07:00', '08:00', 'completed', now() - interval '1 day'),
  ('60000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000201', '50000000-0000-4000-8000-000000000203', '10000000-0000-4000-8000-000000000201', 'initial', 'Future frozen', '13:00', '14:00', 'pending', null),
  ('60000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000201', '50000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000205', 'initial', 'Cancelled frozen', null, null, 'cancelled', null),
  ('60000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000201', '50000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000206', 'initial', 'Rescheduled frozen', null, null, 'rescheduled', null);

create temp table original_plans as select id, to_jsonb(p) as body from public.daily_plans p;
create temp table original_items as select id, to_jsonb(i) as body from public.daily_plan_items i;
grant select on original_plans, original_items to authenticated;

-- Inject a failure in the second write to prove the first write rolls back.
create function pg_temp.reject_execution_write() returns trigger language plpgsql as $$
begin
  if current_setting('rp_test.fail_execution', true) = 'on' then
    raise exception 'TEST_EXECUTION_FAILURE';
  end if;
  return new;
end;
$$;
create trigger m2_test_reject_write before update on public.daily_plan_items
for each row execute function pg_temp.reject_execution_write();

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';

select throws_ok(
  format('select public.set_task_completion(%L,%L,true)', (now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000203'),
  'P0002', 'TASK_NOT_FOUND', 'foreign Task IDs cannot be used in an owned plan'
);
select throws_ok(
  format('select public.set_task_completion(%L,%L,true)', (now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000204'),
  'P0002', 'DAILY_ITEM_NOT_FOUND', 'unrelated Tasks do not acquire a fabricated daily relation'
);
select throws_ok(
  format('select public.set_task_completion(%L,%L,true)', (now() at time zone 'Pacific/Kiritimati')::date + offset_days, '10000000-0000-4000-8000-000000000201'),
  'P0001', 'TASK_DATE_NOT_CURRENT', 'past and future date execution is rejected'
) from (values (-1), (1)) offsets(offset_days);
select throws_ok(
  format('select public.set_task_completion(%L,%L,%L)', (now() at time zone 'Pacific/Kiritimati')::date, task_id, completed),
  'P0001', 'DAILY_ITEM_EXECUTION_NOT_ALLOWED', 'cancelled/rescheduled results cannot be overwritten'
) from (values ('10000000-0000-4000-8000-000000000205'), ('10000000-0000-4000-8000-000000000206')) tasks(task_id)
cross join (values (true), (false)) actions(completed);
select throws_ok(
  $$ select public.set_task_completion(null, '10000000-0000-4000-8000-000000000201', true) $$,
  '22023', 'INVALID_TASK_EXECUTION_REQUEST', 'missing context is rejected'
);

set local rp_test.fail_execution = 'on';
select throws_ok(
  format('select public.set_task_completion(%L,%L,true)', (now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201'),
  'P0001', 'TEST_EXECUTION_FAILURE', 'a Daily Item failure aborts the complete transition'
);
select is((select status from public.tasks where id = '10000000-0000-4000-8000-000000000201'), 'open', 'Task write rolled back');
select is((select result_status from public.daily_plan_items where id = '60000000-0000-4000-8000-000000000201'), 'pending', 'Daily Item remains pending');
set local rp_test.fail_execution = 'off';

create temp table first_complete as
select public.set_task_completion((now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201', true) as body;
select is((select body->>'changed' from first_complete), 'true', 'first complete changes execution');
select is((select status from public.tasks where id = '10000000-0000-4000-8000-000000000201'), 'completed', 'Task is globally completed');
select ok(
  (select result_status = 'completed' and completed_at_on_day is not null
   from public.daily_plan_items where id = '60000000-0000-4000-8000-000000000201'),
  'target day execution is persisted with a timestamp'
);
select is(
  public.set_task_completion((now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201', true),
  (select jsonb_set(body, '{changed}', 'false') from first_complete),
  'complete retry preserves both original timestamps and emits no change'
);

set local rp_test.fail_execution = 'on';
select throws_ok(
  format('select public.set_task_completion(%L,%L,false)', (now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201'),
  'P0001', 'TEST_EXECUTION_FAILURE', 'an Item failure also aborts uncomplete'
);
select is((select status from public.tasks where id = '10000000-0000-4000-8000-000000000201'), 'completed', 'failed uncomplete preserves global completion');
set local rp_test.fail_execution = 'off';

create temp table first_uncomplete as
select public.set_task_completion((now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201', false) as body;
select ok(
  (select status = 'open' and completed_at is null from public.tasks where id = '10000000-0000-4000-8000-000000000201')
  and (select result_status = 'pending' and completed_at_on_day is null from public.daily_plan_items where id = '60000000-0000-4000-8000-000000000201'),
  'uncomplete restores open/pending and clears completion timestamps'
);
select is(
  public.set_task_completion((now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201', false),
  (select jsonb_set(body, '{changed}', 'false') from first_uncomplete), 'uncomplete retry preserves updated_at timestamps'
);
select is(
  public.set_task_completion((now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000202', true)->'item'->>'resultStatus',
  'completed', 'Added Later execution uses the same command'
);
select is(
  public.set_task_completion((now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000202', false)->'item'->>'resultStatus',
  'pending', 'Added Later can also be uncompleted'
);

reset role;
update public.tasks set status = 'completed', completed_at = now() - interval '1 day', updated_at = now() - interval '1 day'
where id = '10000000-0000-4000-8000-000000000201';
set local role authenticated;
create temp table previous_global_completion as
select completed_at, updated_at from public.tasks where id = '10000000-0000-4000-8000-000000000201';
select is(
  public.set_task_completion((now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201', true)->'item'->>'resultStatus',
  'completed', 'a globally completed Task can still record its current-day execution'
);
select ok(
  (select t.completed_at = p.completed_at and t.updated_at = p.updated_at
   from public.tasks t cross join previous_global_completion p
   where t.id = '10000000-0000-4000-8000-000000000201')
  and (select i.completed_at_on_day > p.completed_at from public.daily_plan_items i
       cross join previous_global_completion p where i.id = '60000000-0000-4000-8000-000000000201'),
  'global completion time is preserved while the target-day time records this execution'
);
select is(
  public.set_task_completion((now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201', false)->'task'->>'status',
  'open', 'uncomplete never rewrites the other date that remains completed'
);
select ok(
  not exists (select 1 from public.daily_plans p join original_plans o using (id)
    where (to_jsonb(p) - array['total_item_count','completed_item_count','must_do_item_count',
      'completed_must_do_item_count','completion_rate','is_qualified','qualified_at','qualification_calculated_at','updated_at'])
    <> (o.body - array['total_item_count','completed_item_count','must_do_item_count',
      'completed_must_do_item_count','completion_rate','is_qualified','qualified_at','qualification_calculated_at','updated_at'])),
  'plan status and initial snapshot metadata are untouched; M2-02 maintains qualification separately'
);
select ok(
  not exists (
    select 1 from public.daily_plan_items i join original_items o using (id)
    where i.daily_plan_id <> '50000000-0000-4000-8000-000000000201' and to_jsonb(i) <> o.body
  ), 'other dates of the same Task are byte-for-byte unchanged'
);
select ok(
  not exists (
    select 1 from public.daily_plan_items i join original_items o using (id)
    where (to_jsonb(i) - array['result_status','completed_at_on_day','updated_at'])
      <> (o.body - array['result_status','completed_at_on_day','updated_at'])
  ), 'title/time/origin/priority snapshots and identity are unchanged for all Items'
);

reset role;
update public.user_settings set timezone = 'invalid/timezone' where user_id = '00000000-0000-4000-8000-000000000201';
set local role authenticated;
select throws_ok(
  format('select public.set_task_completion(%L,%L,true)', (now() at time zone 'Pacific/Kiritimati')::date, '10000000-0000-4000-8000-000000000201'),
  'P0001', 'INVALID_USER_TIMEZONE', 'invalid timezone fails closed'
);
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000202';
select throws_ok(
  format('select public.set_task_completion(%L,%L,true)', (now() at time zone 'UTC')::date, '10000000-0000-4000-8000-000000000203'),
  'P0001', 'DAILY_PLAN_NOT_COMMITTED', 'Draft execution is rejected'
);
select throws_ok(
  format('select public.set_task_completion(%L,%L,true)', (now() at time zone 'UTC')::date + 5, '10000000-0000-4000-8000-000000000201'),
  'P0002', 'DAILY_PLAN_NOT_FOUND', 'caller cannot use a foreign Task without an owned plan'
);

select * from finish();
rollback;

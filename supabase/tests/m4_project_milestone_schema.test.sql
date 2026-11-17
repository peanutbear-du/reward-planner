-- RP-M4-01. Run on a disposable database with all migrations and pgTAP.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c401', 'm4-project-a@example.test'),
  ('00000000-0000-4000-8000-00000000c402', 'm4-project-b@example.test');

insert into public.projects (id, user_id, title, scale) values
  ('20000000-0000-4000-8000-00000000c411', '00000000-0000-4000-8000-00000000c401', 'Small', 'small'),
  ('20000000-0000-4000-8000-00000000c412', '00000000-0000-4000-8000-00000000c401', 'Medium', 'medium'),
  ('20000000-0000-4000-8000-00000000c413', '00000000-0000-4000-8000-00000000c401', 'Large', 'large');
insert into public.projects (id, user_id, title, scale, reward_pool) values
  ('20000000-0000-4000-8000-00000000c414', '00000000-0000-4000-8000-00000000c402', 'Major', 'major', 999);

select results_eq(
  $$ select reward_pool from public.projects
     where id in ('20000000-0000-4000-8000-00000000c411', '20000000-0000-4000-8000-00000000c412',
                  '20000000-0000-4000-8000-00000000c413', '20000000-0000-4000-8000-00000000c414')
     order by id $$,
  array[4, 8, 16, 24],
  'insert snapshots all four pools from scale, even if a value is supplied'
);
select ok(
  (select status = 'active' and not scale_locked and completed_at is null
   from public.projects where id = '20000000-0000-4000-8000-00000000c411'),
  'a new Project is active and its scale starts unlocked'
);
select throws_ok($$ insert into public.projects (user_id, title, scale)
  values ('00000000-0000-4000-8000-00000000c401', 'Invalid scale', 'unknown') $$,
  '23514', null, 'unknown Project scale is rejected');
select throws_ok($$ update public.projects set status = 'completed'
  where id = '20000000-0000-4000-8000-00000000c411' $$,
  '23514', null, 'a completed Project requires its completion timestamp');

insert into public.milestones (id, user_id, project_id, title, reward_value) values
  ('30000000-0000-4000-8000-00000000c421', '00000000-0000-4000-8000-00000000c401', '20000000-0000-4000-8000-00000000c411', 'A1', 4),
  ('30000000-0000-4000-8000-00000000c422', '00000000-0000-4000-8000-00000000c401', '20000000-0000-4000-8000-00000000c412', 'A2', 0),
  ('30000000-0000-4000-8000-00000000c423', '00000000-0000-4000-8000-00000000c401', '20000000-0000-4000-8000-00000000c413', 'A3', 16),
  ('30000000-0000-4000-8000-00000000c424', '00000000-0000-4000-8000-00000000c402', '20000000-0000-4000-8000-00000000c414', 'B1', 24);

select throws_ok($$ insert into public.milestones (user_id, project_id, title, reward_value)
  values ('00000000-0000-4000-8000-00000000c402', '20000000-0000-4000-8000-00000000c411', 'Cross-owner', 1) $$,
  '23503', null, 'Milestone cannot link to another owner Project');
select throws_ok($$ update public.milestones set reward_value = -1
  where id = '30000000-0000-4000-8000-00000000c421' $$,
  '23514', null, 'negative Milestone reward is rejected');
select throws_ok($$ update public.milestones set completed_at = now()
  where id = '30000000-0000-4000-8000-00000000c421' $$,
  '23514', null, 'a pending Milestone cannot have a completion timestamp');

insert into public.tasks (id, user_id, title, project_id, milestone_id) values
  ('10000000-0000-4000-8000-00000000c431', '00000000-0000-4000-8000-00000000c401', 'Ordinary A', null, null),
  ('10000000-0000-4000-8000-00000000c432', '00000000-0000-4000-8000-00000000c401', 'Project only', '20000000-0000-4000-8000-00000000c411', null),
  ('10000000-0000-4000-8000-00000000c433', '00000000-0000-4000-8000-00000000c401', 'Milestone only', null, '30000000-0000-4000-8000-00000000c421'),
  ('10000000-0000-4000-8000-00000000c434', '00000000-0000-4000-8000-00000000c401', 'Both links', '20000000-0000-4000-8000-00000000c411', '30000000-0000-4000-8000-00000000c421'),
  ('10000000-0000-4000-8000-00000000c435', '00000000-0000-4000-8000-00000000c402', 'Ordinary B', null, null);

select throws_ok($$ update public.tasks set project_id = '20000000-0000-4000-8000-00000000c414'
  where id = '10000000-0000-4000-8000-00000000c431' $$,
  '23503', null, 'Task cannot reference a foreign Project');
select throws_ok($$ update public.tasks set milestone_id = '30000000-0000-4000-8000-00000000c424'
  where id = '10000000-0000-4000-8000-00000000c431' $$,
  '23503', null, 'Task cannot reference a foreign Milestone even without a Project link');
select throws_ok($$ update public.tasks set project_id = '20000000-0000-4000-8000-00000000c412'
  where id = '10000000-0000-4000-8000-00000000c434' $$,
  '23503', null, 'a Task cannot combine links from two Projects of the same owner');
select throws_ok($$ update public.tasks set project_id = '20000000-0000-4000-8000-00000000c499'
  where id = '10000000-0000-4000-8000-00000000c431' $$,
  '23503', null, 'Task cannot reference a missing Project');
select throws_ok($$ update public.tasks set milestone_id = '30000000-0000-4000-8000-00000000c499'
  where id = '10000000-0000-4000-8000-00000000c431' $$,
  '23503', null, 'Task cannot reference a missing Milestone');

select throws_ok($$ update public.projects set next_action_task_id = '10000000-0000-4000-8000-00000000c435'
  where id = '20000000-0000-4000-8000-00000000c411' $$,
  '23503', null, 'Next Action cannot point to a foreign Task');
update public.projects set next_action_task_id = '10000000-0000-4000-8000-00000000c431'
where id = '20000000-0000-4000-8000-00000000c411';
select ok(
  (select p.next_action_task_id = t.id and t.project_id is null and t.milestone_id is null
   from public.projects p join public.tasks t on p.next_action_task_id = t.id
   where p.id = '20000000-0000-4000-8000-00000000c411'),
  'Next Action points to the same ordinary Task without changing its links'
);
delete from public.tasks where id = '10000000-0000-4000-8000-00000000c431';
select ok(
  (select next_action_task_id is null and user_id = '00000000-0000-4000-8000-00000000c401'
   from public.projects where id = '20000000-0000-4000-8000-00000000c411'),
  'deleting the referenced Task clears Next Action and retains Project ownership'
);

select ok(
  not has_table_privilege('authenticated', 'public.projects', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.milestones', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.projects', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.milestones', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'Project and Milestone writes are reserved for server commands'
);

set local role anon;
select throws_ok($$ select id from public.projects $$, '42501', null, 'anon cannot read Projects');
select throws_ok($$ select id from public.milestones $$, '42501', null, 'anon cannot read Milestones');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c401', true);
select ok((select count(*) = 3 and bool_and(user_id = auth.uid()) from public.projects), 'A sees only own Projects');
select ok((select count(*) = 3 and bool_and(user_id = auth.uid()) from public.milestones), 'A sees only own Milestones');
select ok((select count(*) = 3 and bool_and(user_id = auth.uid()) from public.tasks), 'A sees only own linked Tasks');
select is((select reward_pool from public.projects where id = '20000000-0000-4000-8000-00000000c411'),
  4, 'owner reads the stored pool');
select throws_ok($$ update public.projects set reward_pool = 99 $$,
  '42501', null, 'authenticated user cannot overwrite a pool');
select throws_ok($$ update public.milestones set reward_value = 99 $$,
  '42501', null, 'authenticated user cannot assign Milestone reward');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c402', true);
select ok((select count(*) = 1 and bool_and(user_id = auth.uid()) from public.projects), 'B sees only own Project');
select ok((select count(*) = 1 and bool_and(user_id = auth.uid()) from public.milestones), 'B sees only own Milestone');
select ok((select count(*) = 1 and bool_and(user_id = auth.uid()) from public.tasks), 'B sees only own Task');
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Simulate a future reward rule inside the rolled-back test transaction.
create or replace function public.snapshot_project_reward_pool() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.reward_pool := 40;
  return new;
end;
$$;
insert into public.projects (id, user_id, title, scale) values
  ('20000000-0000-4000-8000-00000000c415', '00000000-0000-4000-8000-00000000c401', 'New small', 'small');
update public.projects set title = 'Original small'
where id = '20000000-0000-4000-8000-00000000c411';
select is((select reward_pool from public.projects where id = '20000000-0000-4000-8000-00000000c415'),
  40, 'a new Project uses the updated insert rule');
select is((select reward_pool from public.projects where id = '20000000-0000-4000-8000-00000000c411'),
  4, 'existing Project retains its stored reward pool after a rule change and edit');

delete from auth.users where id in ('00000000-0000-4000-8000-00000000c401', '00000000-0000-4000-8000-00000000c402');
select ok(
  not exists (select 1 from public.projects where user_id in ('00000000-0000-4000-8000-00000000c401', '00000000-0000-4000-8000-00000000c402'))
  and not exists (select 1 from public.milestones where user_id in ('00000000-0000-4000-8000-00000000c401', '00000000-0000-4000-8000-00000000c402'))
  and not exists (select 1 from public.tasks where user_id in ('00000000-0000-4000-8000-00000000c401', '00000000-0000-4000-8000-00000000c402')),
  'owner deletion removes the fixture Projects, Milestones, and Tasks'
);

select * from finish();
rollback;

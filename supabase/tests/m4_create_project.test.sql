-- RP-M4-02. Run only on a disposable Supabase PostgreSQL with pgTAP and all migrations.
-- The two test-only triggers and all fixture data are rolled back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = public, extensions, pg_temp;
select no_plan();

select ok(
  (select prosecdef and proconfig in (array['search_path=""'], array['search_path='])
   from pg_proc where oid = 'public.create_project(text,text,jsonb,date)'::regprocedure),
  'command uses SECURITY DEFINER with an empty search_path'
);
select ok(has_function_privilege('authenticated', 'public.create_project(text,text,jsonb,date)', 'EXECUTE'),
  'authenticated role can create Projects');
select ok(not has_function_privilege(role_name::name, 'public.create_project(text,text,jsonb,date)', 'EXECUTE'),
  role_name || ' cannot execute the command')
from (values ('anon'), ('service_role')) roles(role_name);
select ok(not exists (
  select 1 from pg_proc p, aclexplode(p.proacl) acl
  where p.oid = 'public.create_project(text,text,jsonb,date)'::regprocedure
    and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
), 'PUBLIC has no explicit EXECUTE grant');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c501', 'm4-create-a@example.test'),
  ('00000000-0000-4000-8000-00000000c502', 'm4-create-b@example.test');

-- Simulate a future snapshot rule for one fixture. This runs after the normal
-- snapshot trigger, proving the command uses the stored value rather than scale constants.
create function pg_temp.change_fixture_pool() returns trigger language plpgsql as $$
begin
  if new.title = 'Changed snapshot rule' then
    new.reward_pool := 11;
  end if;
  return new;
end;
$$;
create trigger z_test_project_pool
  before insert on public.projects for each row execute function pg_temp.change_fixture_pool();

-- Refuse a real insert only after verifying that an earlier Milestone has been written.
create function pg_temp.fail_second_milestone() returns trigger language plpgsql as $$
begin
  if new.title = 'Fixture must fail' then
    if not exists (
      select 1 from public.milestones
      where project_id = new.project_id and title = 'Fixture inserted first'
    ) then
      raise exception 'Rollback fixture setup failed';
    end if;
    raise exception 'Fixture second Milestone rejected' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger test_project_rollback
  before insert on public.milestones for each row execute function pg_temp.fail_second_milestone();

set local role authenticated;
set local request.jwt.claim.sub = '';
select throws_ok($$select public.create_project('No identity', 'small', '[{"title":"One"}]')$$,
  '42501', 'AUTHENTICATION_REQUIRED', 'JWT subject required');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000c501';

create temp table created_single as
select scale, pool, public.create_project('Single ' || scale, scale, '[{"title":"One"}]') as body
from (values ('small', 4), ('medium', 8), ('large', 16), ('major', 24)) scales(scale, pool);
select is((body->'project'->>'rewardPool')::integer, pool, scale || ' returns the pool snapshot') from created_single;
select is((body->'milestones'->0->>'rewardValue')::integer, pool, scale || ' allocates the full pool to one Milestone')
from created_single;
select is(p.reward_pool, s.pool, s.scale || ' persists the pool snapshot')
from created_single s left join public.projects p on p.id = (s.body->'project'->>'id')::uuid;
select is(m.reward_value, s.pool, s.scale || ' persists the single Milestone allocation')
from created_single s left join public.milestones m on m.id = (s.body->'milestones'->0->>'id')::uuid;

create temp table created_batch as
select public.create_project(
  ' Medium batch ', 'medium',
  '[{"title":" Book ","dueDate":"2028-02-29"},{"title":"Pack","dueDate":null},{"title":"Depart"}]',
  '2028-03-01'
) as body;

select ok((select body->'project' @> '{"title":"Medium batch","status":"active","deadline":"2028-03-01","scaleLocked":false}'::jsonb
  from created_batch), 'Project response includes the normalized title and initial state');
select is((select body->'milestones'->0->>'dueDate' from created_batch), '2028-02-29', 'valid leap-day Milestone date is returned');
select is((select body->'milestones'->2->>'dueDate' from created_batch), null::text, 'an omitted Milestone date is null');
select results_eq(
  $$ select m->>'title', (m->>'rewardValue')::integer
     from created_batch, jsonb_array_elements(body->'milestones') with ordinality as items(m, position)
     order by position $$,
  $$ values ('Book', 2), ('Pack', 2), ('Depart', 4) $$,
  'Medium pool is allocated in input order with all remainder on the last Milestone'
);
select results_eq(
  $$ select m.title, m.reward_value, m.due_date, m.user_id
     from created_batch, jsonb_array_elements(body->'milestones') with ordinality as items(item, position)
     left join public.milestones m on m.id = (item->>'id')::uuid
     order by position $$,
  $$ values
     ('Book', 2, '2028-02-29'::date, '00000000-0000-4000-8000-00000000c501'::uuid),
     ('Pack', 2, null, '00000000-0000-4000-8000-00000000c501'::uuid),
     ('Depart', 4, null, '00000000-0000-4000-8000-00000000c501'::uuid) $$,
  'allocations, dates and ownership match the stored Milestones'
);
select ok((select p.user_id = auth.uid() and p.deadline = '2028-03-01'::date
  and p.status = 'active' and not p.scale_locked and p.completed_at is null and p.next_action_task_id is null
  from public.projects p, created_batch b where p.id = (b.body->'project'->>'id')::uuid),
  'the persisted Project uses JWT ownership and starts active with no Next Action');

create temp table changed_snapshot as
select public.create_project('Changed snapshot rule', 'medium',
  '[{"title":"First"},{"title":"Second"},{"title":"Third"}]') as body;
select is((select (body->'project'->>'rewardPool')::integer from changed_snapshot), 11, 'command returns the changed database snapshot');
select is((select array_agg((m->>'rewardValue')::integer order by position)
  from changed_snapshot, jsonb_array_elements(body->'milestones') with ordinality as items(m, position)),
  array[3,3,5], 'allocation uses the changed stored snapshot');

create temp table over_count as
select public.create_project('Low budget', 'small',
  '[{"title":"1"},{"title":"2"},{"title":"3"},{"title":"4"},{"title":"5"}]') as body;
select is((select array_agg((m->>'rewardValue')::integer order by position)
  from over_count, jsonb_array_elements(body->'milestones') with ordinality as items(m, position)),
  array[0,0,0,0,4], 'the integer rule still applies when Milestones outnumber points');

create temp table before_failure as
select (select count(*) from public.projects) projects, (select count(*) from public.milestones) milestones;

select throws_ok(format('select public.create_project(%L, %L, %L::jsonb)', 'Rejected', 'medium', payload),
  '22023', 'INVALID_PROJECT_REQUEST', description)
from (values
  (null::text, 'null list is rejected'),
  ('[]', 'empty list is rejected'),
  ('{}', 'non-array list is rejected'),
  ('[null]', 'null Milestone is rejected'),
  ('[{"title":1}]', 'non-string title is rejected'),
  ('[{"title":" "}]', 'blank title is rejected'),
  ('[{"title":"One","dueDate":"2027-02-29"}]', 'invalid calendar date is rejected'),
  ('[{"title":"One","userId":"foreign"}]', 'fake Milestone ownership is rejected'),
  ('[{"title":"One","projectId":"foreign"}]', 'fake Milestone project link is rejected'),
  ('[{"title":"One","rewardValue":99}]', 'client-selected reward points are rejected')
) invalid(payload, description);

select throws_ok($$select public.create_project('Rollback fixture', 'medium',
  '[{"title":"Fixture inserted first"},{"title":"Fixture must fail"}]')$$,
  '23514', 'Fixture second Milestone rejected', 'late insert fails after the earlier Milestone exists');
select is((select count(*) from public.projects), (select projects from before_failure),
  'no Project survives a failed request');
select is((select count(*) from public.milestones), (select milestones from before_failure),
  'no Milestones survive a failed request');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000c502';
select is((select count(*) from public.projects), 0::bigint, 'owner B cannot read owner A Projects');
select is((select count(*) from public.milestones), 0::bigint, 'owner B cannot read owner A Milestones');
create temp table created_b as
select public.create_project('Only B', 'major', '[{"title":"Only B Milestone"}]') as body;
select is((select count(*) from public.projects where title = 'Only B' and user_id = auth.uid()),
  1::bigint, 'owner B can create their own Project');
select is((select count(*) from public.milestones where title = 'Only B Milestone' and user_id = auth.uid()),
  1::bigint, 'owner B can create their own Milestone');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000c501';
select is((select count(*) from public.projects where id = (select (body->'project'->>'id')::uuid from created_b)),
  0::bigint, 'owner A cannot read owner B Project by ID');
select is((select count(*) from public.milestones where id = (select (body->'milestones'->0->>'id')::uuid from created_b)),
  0::bigint, 'owner A cannot read owner B Milestone by ID');
select throws_ok($$insert into public.projects(user_id, title, scale) values (auth.uid(), 'Direct', 'small')$$,
  '42501', null, 'authenticated caller cannot bypass creation with a direct Project insert');
select throws_ok($$insert into public.milestones(user_id, project_id, title, reward_value)
  select auth.uid(), (body->'project'->>'id')::uuid, 'Direct', 4 from created_batch$$,
  '42501', null, 'authenticated caller cannot bypass allocation with a direct Milestone insert');

reset role;
select is((select count(*) from public.reward_events where user_id in
  ('00000000-0000-4000-8000-00000000c501', '00000000-0000-4000-8000-00000000c502')),
  0::bigint, 'creation grants no rewards');

select * from finish();
rollback;

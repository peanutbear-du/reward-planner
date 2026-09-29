begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
  ),
  'profile bootstrap trigger exists on auth.users'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.handle_new_user()'::regprocedure
      and prosecdef
  ),
  'profile bootstrap function is security definer'
);

select is(
  (
    select proconfig
    from pg_catalog.pg_proc
    where oid = 'public.handle_new_user()'::regprocedure
  ),
  array['search_path=']::text[],
  'profile bootstrap function has an empty search_path'
);

select ok(
  not has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
  'anon cannot execute the bootstrap function'
);

select ok(
  not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  'authenticated cannot execute the bootstrap function'
);

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (id, email)
values (
  '00000000-0000-4000-8000-000000000003',
  'm1-existing@example.test'
);

select is(
  (
    select count(*)
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'a pre-trigger auth user starts without a profile'
);

alter table auth.users enable trigger on_auth_user_created;

insert into public.profiles (id)
select users.id
from auth.users as users
on conflict (id) do nothing;

select is(
  (
    select count(*)
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000003'
  ),
  1::bigint,
  'backfill creates the missing profile'
);

insert into public.profiles (id)
select users.id
from auth.users as users
on conflict (id) do nothing;

select is(
  (
    select count(*)
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000003'
  ),
  1::bigint,
  'backfill is idempotent'
);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-000000000001', 'm1-user-a@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'm1-user-b@example.test');

select is(
  (
    select count(*)
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the auth trigger creates User A profile exactly once'
);

select is(
  (
    select count(*)
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'the auth trigger creates User B profile exactly once'
);

select is(
  (
    select count(*)
    from auth.users as users
    left join public.profiles as profiles on profiles.id = users.id
    where profiles.id is null
  ),
  0::bigint,
  'all auth users have a profile after bootstrap and backfill'
);

select results_eq(
  $$
    select relname::text
    from pg_catalog.pg_class
    where oid in (
      'public.profiles'::regclass,
      'public.user_settings'::regclass,
      'public.tasks'::regclass,
      'public.planning_items'::regclass,
      'public.daily_plans'::regclass,
      'public.daily_plan_items'::regclass
    )
      and relrowsecurity
    order by relname
  $$,
  $$
    values
      ('daily_plan_items'::text),
      ('daily_plans'::text),
      ('planning_items'::text),
      ('profiles'::text),
      ('tasks'::text),
      ('user_settings'::text)
  $$,
  'RLS is enabled on all six M1 user-owned tables'
);

select results_eq(
  $$
    select tablename::text, policyname::text, cmd::text
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'user_settings',
        'tasks',
        'planning_items',
        'daily_plans',
        'daily_plan_items'
      )
    order by tablename, policyname
  $$,
  $$
    values
      ('daily_plan_items'::text, 'daily_plan_items_select_own'::text, 'SELECT'::text),
      ('daily_plans'::text, 'daily_plans_select_own'::text, 'SELECT'::text),
      ('planning_items'::text, 'planning_items_select_own'::text, 'SELECT'::text),
      ('profiles'::text, 'profiles_select_own'::text, 'SELECT'::text),
      ('profiles'::text, 'profiles_update_own'::text, 'UPDATE'::text),
      ('tasks'::text, 'tasks_select_own'::text, 'SELECT'::text),
      ('user_settings'::text, 'user_settings_insert_own'::text, 'INSERT'::text),
      ('user_settings'::text, 'user_settings_select_own'::text, 'SELECT'::text),
      ('user_settings'::text, 'user_settings_update_own'::text, 'UPDATE'::text)
  $$,
  'only the approved M1 policies exist'
);

select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name in (
        'profiles',
        'user_settings',
        'tasks',
        'planning_items',
        'daily_plans',
        'daily_plan_items'
      )
  ),
  0::bigint,
  'anon has no table grants on M1 user-owned tables'
);

select results_eq(
  $$
    select table_name::text
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in (
        'tasks',
        'planning_items',
        'daily_plans',
        'daily_plan_items'
      )
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    order by table_name
  $$,
  $$ select null::text where false $$,
  'authenticated has no direct domain table write grants'
);

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update'),
  'authenticated can update profile display_name'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'id', 'update')
    and not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update')
    and not has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'update'),
  'authenticated cannot update profile ownership or timestamps'
);

update public.profiles
set display_name = case id
  when '00000000-0000-4000-8000-000000000001' then 'User A'
  when '00000000-0000-4000-8000-000000000002' then 'User B'
  else display_name
end;

insert into public.tasks (id, user_id, title)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'User A task'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'User B task'
  );

insert into public.planning_items (id, user_id, task_id, planned_date)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '2026-09-27'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '2026-09-27'
  );

insert into public.daily_plans (id, user_id, plan_date)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '2026-09-27'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '2026-09-27'
  );

insert into public.daily_plan_items (
  id,
  user_id,
  daily_plan_id,
  task_id,
  title_snapshot
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'User A task'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'User B task'
  );

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'User A can read only one profile'
);

select is(
  (select id from public.profiles),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'User A can read their own profile'
);

select lives_ok(
  $$ update public.profiles set display_name = 'User A updated' $$,
  'User A can update their own display name'
);

select lives_ok(
  $$ update public.profiles set display_name = 'tampered' where id = '00000000-0000-4000-8000-000000000002' $$,
  'an update targeting User B is filtered instead of applied for User A'
);

select lives_ok(
  $$
    insert into public.user_settings (user_id, timezone, locale)
    values (
      '00000000-0000-4000-8000-000000000001',
      'Asia/Shanghai',
      'en-US'
    )
  $$,
  'User A can create their own settings'
);

select lives_ok(
  $$ update public.user_settings set locale = 'zh-CN' $$,
  'User A can update their own settings'
);

select throws_ok(
  $$
    insert into public.user_settings (user_id, timezone)
    values ('00000000-0000-4000-8000-000000000002', 'UTC')
  $$,
  '42501',
  null,
  'User A cannot create User B settings'
);

select is(
  (select count(*) from public.tasks),
  1::bigint,
  'User A sees only their task'
);

select is(
  (select user_id from public.tasks),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'User A task row has User A ownership'
);

select is(
  (select count(*) from public.planning_items),
  1::bigint,
  'User A sees only their planning item'
);

select is(
  (select user_id from public.planning_items),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'User A planning row has User A ownership'
);

select is(
  (select count(*) from public.daily_plans),
  1::bigint,
  'User A sees only their daily plan'
);

select is(
  (select user_id from public.daily_plans),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'User A daily plan has User A ownership'
);

select is(
  (select count(*) from public.daily_plan_items),
  1::bigint,
  'User A sees only their daily plan item'
);

select is(
  (select user_id from public.daily_plan_items),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'User A daily plan item has User A ownership'
);

select throws_ok(
  $$
    insert into public.tasks (user_id, title)
    values ('00000000-0000-4000-8000-000000000001', 'Forbidden direct task')
  $$,
  '42501',
  null,
  'authenticated cannot insert tasks directly'
);

select throws_ok(
  $$ update public.planning_items set planned_date = '2026-09-28' $$,
  '42501',
  null,
  'authenticated cannot update planning items directly'
);

select throws_ok(
  $$ delete from public.daily_plans $$,
  '42501',
  null,
  'authenticated cannot delete daily plans directly'
);

select throws_ok(
  $$
    insert into public.daily_plan_items (
      user_id,
      daily_plan_id,
      task_id,
      title_snapshot
    )
    values (
      '00000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'Forbidden direct daily item'
    )
  $$,
  '42501',
  null,
  'authenticated cannot insert daily plan items directly'
);

reset role;

select is(
  (
    select display_name
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000002'
  ),
  'User B'::text,
  'User A cannot modify User B profile'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'User B can read only one profile'
);

select is(
  (select id from public.profiles),
  '00000000-0000-4000-8000-000000000002'::uuid,
  'User B can read their own profile'
);

select lives_ok(
  $$
    insert into public.user_settings (user_id, timezone, locale)
    values (
      '00000000-0000-4000-8000-000000000002',
      'UTC',
      'en-US'
    )
  $$,
  'User B can create their own settings'
);

select lives_ok(
  $$ update public.user_settings set locale = 'zh-CN' $$,
  'User B can update their own settings'
);

select throws_ok(
  $$
    insert into public.user_settings (user_id, timezone)
    values ('00000000-0000-4000-8000-000000000001', 'UTC')
  $$,
  '42501',
  null,
  'User B cannot create User A settings'
);

select lives_ok(
  $$ update public.user_settings set locale = 'tampered' where user_id = '00000000-0000-4000-8000-000000000001' $$,
  'an update targeting User A is filtered instead of applied for User B'
);

select is(
  (select count(*) from public.tasks),
  1::bigint,
  'User B sees only their task'
);

select is(
  (select user_id from public.tasks),
  '00000000-0000-4000-8000-000000000002'::uuid,
  'User B task row has User B ownership'
);

select is(
  (select count(*) from public.planning_items),
  1::bigint,
  'User B sees only their planning item'
);

select is(
  (select user_id from public.planning_items),
  '00000000-0000-4000-8000-000000000002'::uuid,
  'User B planning row has User B ownership'
);

select is(
  (select count(*) from public.daily_plans),
  1::bigint,
  'User B sees only their daily plan'
);

select is(
  (select user_id from public.daily_plans),
  '00000000-0000-4000-8000-000000000002'::uuid,
  'User B daily plan has User B ownership'
);

select is(
  (select count(*) from public.daily_plan_items),
  1::bigint,
  'User B sees only their daily plan item'
);

select is(
  (select user_id from public.daily_plan_items),
  '00000000-0000-4000-8000-000000000002'::uuid,
  'User B daily plan item has User B ownership'
);

reset role;

select is(
  (
    select locale
    from public.user_settings
    where user_id = '00000000-0000-4000-8000-000000000001'
  ),
  'zh-CN'::text,
  'User B cannot modify User A settings'
);

set local role anon;
set local request.jwt.claim.sub = '';

select throws_ok(
  $$ select * from public.profiles $$,
  '42501',
  null,
  'anon cannot read profiles'
);

select throws_ok(
  $$ select * from public.user_settings $$,
  '42501',
  null,
  'anon cannot read user settings'
);

select throws_ok(
  $$ select * from public.tasks $$,
  '42501',
  null,
  'anon cannot read tasks'
);

select throws_ok(
  $$ select * from public.planning_items $$,
  '42501',
  null,
  'anon cannot read planning items'
);

select throws_ok(
  $$ select * from public.daily_plans $$,
  '42501',
  null,
  'anon cannot read daily plans'
);

select throws_ok(
  $$ select * from public.daily_plan_items $$,
  '42501',
  null,
  'anon cannot read daily plan items'
);

select throws_ok(
  $$
    insert into public.user_settings (user_id)
    values ('00000000-0000-4000-8000-000000000001')
  $$,
  '42501',
  null,
  'anon cannot insert user settings'
);

select throws_ok(
  $$ update public.profiles set display_name = 'anonymous tamper' $$,
  '42501',
  null,
  'anon cannot update profiles'
);

select throws_ok(
  $$ delete from public.tasks $$,
  '42501',
  null,
  'anon cannot delete tasks'
);

reset role;

select * from finish();

rollback;

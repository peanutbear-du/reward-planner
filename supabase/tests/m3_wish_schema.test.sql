-- Disposable/local PostgreSQL only, after migrations. No remote/schema repair.
-- All fixtures and explicit cleanup remain inside this rolled-back transaction.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', table_name, table_name || ' exists')
from (values ('wishes'), ('reward_allocations')) tables(table_name);
select ok((select relrowsecurity from pg_class where oid = ('public.' || table_name)::regclass), table_name || ' enables RLS')
from (values ('wishes'), ('reward_allocations')) tables(table_name);
select ok(has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
 and not has_table_privilege('anon', 'public.' || table_name, 'SELECT'), table_name || ' grants authenticated reads only')
from (values ('wishes'), ('reward_allocations')) tables(table_name);
select ok(not has_table_privilege(role_name::name, 'public.' || table_name, operation), role_name || ' cannot ' || operation || ' ' || table_name)
from (values ('anon'), ('authenticated')) roles(role_name)
cross join (values ('wishes'), ('reward_allocations')) tables(table_name)
cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) operations(operation);
select ok((select count(*) = 1 and bool_and(polcmd = 'r') from pg_policy where polrelid = ('public.' || table_name)::regclass),
 table_name || ' has only a SELECT policy')
from (values ('wishes'), ('reward_allocations')) tables(table_name);
select ok((select atttypid = 'integer'::regtype from pg_attribute
 where attrelid = 'public.wishes'::regclass and attname = 'target'), 'Wish target is an integer');
select ok((select atttypid = 'integer'::regtype from pg_attribute
 where attrelid = 'public.reward_allocations'::regclass and attname = 'amount'), 'Allocation amount is a signed integer');
select ok((select indisunique and indpred is not null from pg_index where indexrelid = 'public.wishes_one_unlocking_per_user_key'::regclass),
 'single Unlocking invariant is backed by a partial unique index');

insert into auth.users (id, email) values
 ('00000000-0000-4000-8000-000000000801', 'm3-wish-a@example.test'),
 ('00000000-0000-4000-8000-000000000802', 'm3-wish-b@example.test');
insert into public.user_settings (user_id, timezone) values
 ('00000000-0000-4000-8000-000000000801', 'UTC'),
 ('00000000-0000-4000-8000-000000000802', 'UTC');
insert into public.tasks (id, user_id, title) values
 ('10000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000801', 'Daily A'),
 ('10000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000802', 'Daily B');
insert into public.daily_plans (id, user_id, plan_date, status, snapshot_created_at) values
 ('50000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000801', (clock_timestamp() at time zone 'UTC')::date, 'committed', now()),
 ('50000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000802', (clock_timestamp() at time zone 'UTC')::date, 'committed', now());
insert into public.daily_plan_items (user_id, daily_plan_id, task_id, title_snapshot) values
 ('00000000-0000-4000-8000-000000000801', '50000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'Frozen A'),
 ('00000000-0000-4000-8000-000000000802', '50000000-0000-4000-8000-000000000802', '10000000-0000-4000-8000-000000000802', 'Frozen B');
-- Generate genuine Daily Events through existing commands/triggers.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, '10000000-0000-4000-8000-000000000801', true);
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000802';
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date, '10000000-0000-4000-8000-000000000802', true);
reset role;
set local request.jwt.claim.sub = '';
create temp table original_events as select id, user_id, to_jsonb(e) body from public.reward_events e
 where user_id in ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000802');
select is((select count(*)::integer from original_events), 2, 'Daily commands create one +1 per qualified owner');
select is((select count(*)::integer from public.reward_allocations where user_id in
 ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802')), 2, 'M3-04 Daily kernel creates one Pending credit per fixture owner');
-- Reconstruct the old signed representation for constraint/adoption checks.
-- Only these fresh transaction fixtures; never remove real allocation history.
delete from public.reward_allocations where user_id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802');
delete from public.wish_reward_state where user_id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802');

insert into public.wishes (id, user_id, title, target) values
 ('70000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000801', 'A Wishlist one', 60),
 ('70000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801', 'A Wishlist two', 1),
 ('70000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000802', 'B Wishlist', 20);
select is((select count(*)::integer from public.wishes where user_id = '00000000-0000-4000-8000-000000000801' and status = 'wishlist'), 2,
 'one user can keep multiple Wishlist rows');
select ok((select cover_path is null and reference_price is null and why is null and started_at is null
 and unlocked_at is null and redeemed_at is null and created_at is not null and updated_at is not null
 from public.wishes where id = '70000000-0000-4000-8000-000000000801'), 'optional Wish fields/default timestamps are correct');
insert into public.wishes (id, user_id, title, target, status, started_at) values
 ('70000000-0000-4000-8000-000000000804', '00000000-0000-4000-8000-000000000801', 'A current', 40, 'unlocking', now()),
 ('70000000-0000-4000-8000-000000000805', '00000000-0000-4000-8000-000000000802', 'B current', 100, 'unlocking', now());
select throws_ok($$insert into public.wishes (user_id,title,target,status) values ('00000000-0000-4000-8000-000000000801','Second current',1,'unlocking')$$,
 '23505', null, 'second Unlocking Wish for the same owner is rejected');
select throws_ok($$update public.wishes set status='unlocking' where id='70000000-0000-4000-8000-000000000801'$$,
 '23505', null, 'updates cannot bypass the single-Unlocking invariant');
update public.wishes set status='wishlist' where id='70000000-0000-4000-8000-000000000804';
update public.wishes set status='unlocking',started_at=now() where id='70000000-0000-4000-8000-000000000801';
select ok((select status='wishlist' and started_at is not null from public.wishes where id='70000000-0000-4000-8000-000000000804'),
 'switching back to Wishlist can retain start history');

select throws_ok(format('insert into public.wishes(user_id,title,target) values (%L,%L,1)', '00000000-0000-4000-8000-000000000801', title),
 '23514', null, 'empty/whitespace title rejected') from (values (''), ('   '), (E'\t\n\r')) invalid(title);
select throws_ok(format('insert into public.wishes(user_id,title,target) values (%L,%L,%s)', '00000000-0000-4000-8000-000000000801', 'bad target', target),
 '23514', null, 'nonpositive target rejected') from (values (0), (-1)) invalid(target);
select throws_ok($$insert into public.wishes(user_id,title,target) values ('00000000-0000-4000-8000-000000000801','fractional text','1.5')$$,
 '22P02', null, 'fractional text is not an integer target');
select throws_ok($$insert into public.wishes(user_id,title,target,status) values ('00000000-0000-4000-8000-000000000801','invalid status',1,'paused')$$,
 '23514', null, 'unknown Wish status rejected');
select throws_ok(sql, '23502', null, 'required Wish value cannot be null') from (values
 ($$insert into public.wishes(user_id,title,target) values (null,'Title',1)$$),
 ($$insert into public.wishes(user_id,title,target) values ('00000000-0000-4000-8000-000000000801',null,1)$$),
 ($$insert into public.wishes(user_id,title,target) values ('00000000-0000-4000-8000-000000000801','Title',null)$$),
 ($$insert into public.wishes(user_id,title,target,status) values ('00000000-0000-4000-8000-000000000801','Title',1,null)$$),
 ($$insert into public.wishes(user_id,title,target,created_at) values ('00000000-0000-4000-8000-000000000801','Title',1,null)$$),
 ($$insert into public.wishes(user_id,title,target,updated_at) values ('00000000-0000-4000-8000-000000000801','Title',1,null)$$)
 ) invalid(sql);
select throws_ok($$insert into public.wishes(user_id,title,target) values ('00000000-0000-4000-8000-000000000899','Orphan',1)$$,
 '23503', null, 'Wish owner must have an existing profile');

-- Privileged representation fixtures: Pending -> Wish -> other Wish transfer.
-- This is not an allocation engine, and the original Event remains +1.
insert into public.reward_allocations(user_id,reward_event_id,wish_id,amount,allocation_type)
select '00000000-0000-4000-8000-000000000801',e.id,v.wish_id,v.amount,v.kind from original_events e
cross join (values
 (null::uuid,1,'pending'), (null::uuid,-1,'pending'),
 ('70000000-0000-4000-8000-000000000801'::uuid,1,'wish'),
 ('70000000-0000-4000-8000-000000000801'::uuid,-1,'wish'),
 ('70000000-0000-4000-8000-000000000802'::uuid,1,'wish')
 ) v(wish_id,amount,kind) where e.user_id='00000000-0000-4000-8000-000000000801';
insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type)
select user_id,id,1,'pending' from original_events where user_id='00000000-0000-4000-8000-000000000802';
select is((select count(*)::integer from public.reward_allocations where user_id='00000000-0000-4000-8000-000000000801'),5,
 'one Event retains multiple Wish/Pending allocations and corrections');
select is((select sum(amount) from public.reward_allocations where user_id='00000000-0000-4000-8000-000000000801'),1::bigint,
 'signed transfer fixture retains net +1 source quantity');
select ok(not exists(select 1 from public.reward_events e join original_events o using(id) where to_jsonb(e)<>o.body),
 'allocation writes do not change existing Reward Event fields');

select throws_ok(format('insert into public.reward_allocations(user_id,reward_event_id,wish_id,amount,allocation_type) values (%L,%L,%L,1,%L)',
 '00000000-0000-4000-8000-000000000801',(select id from original_events where user_id='00000000-0000-4000-8000-000000000801'),wish_id,kind),
 '23514',null,'Pending/Wish target relationship rejected') from (values
 ('70000000-0000-4000-8000-000000000801'::uuid,'pending'),(null::uuid,'wish'),(null::uuid,'other')) invalid(wish_id,kind);
select throws_ok(format('insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type) values (%L,%L,0,%L)',
 '00000000-0000-4000-8000-000000000801',(select id from original_events where user_id='00000000-0000-4000-8000-000000000801'),'pending'),
 '23514',null,'zero Allocation rejected');
select throws_ok(format('insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type) values (%L,%L,null,%L)',
 '00000000-0000-4000-8000-000000000801',(select id from original_events where user_id='00000000-0000-4000-8000-000000000801'),'pending'),
 '23502',null,'Allocation amount required');
select throws_ok(format('insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type) values (%L,null,1,%L)',
 '00000000-0000-4000-8000-000000000801','pending'),'23502',null,'Allocation Event required');
select throws_ok(format('insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type) values (%L,%L,1,null)',
 '00000000-0000-4000-8000-000000000801',(select id from original_events where user_id='00000000-0000-4000-8000-000000000801')),
 '23502',null,'Allocation type required');
select throws_ok(format('insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type) values (null,%L,1,%L)',
 (select id from original_events where user_id='00000000-0000-4000-8000-000000000801'),'pending'),'23502',null,'Allocation owner required');
select throws_ok(format('insert into public.reward_allocations(user_id,reward_event_id,wish_id,amount,allocation_type) values (%L,%L,%L,1,%L)',
 owner,event_id,wish_id,kind),'23503',null,'ownership FK rejects foreign/missing Event or Wish even with privileged writes')
from (values
 ('00000000-0000-4000-8000-000000000802'::uuid,(select id from original_events where user_id='00000000-0000-4000-8000-000000000801'),'70000000-0000-4000-8000-000000000803'::uuid,'wish'),
 ('00000000-0000-4000-8000-000000000801'::uuid,(select id from original_events where user_id='00000000-0000-4000-8000-000000000801'),'70000000-0000-4000-8000-000000000803'::uuid,'wish'),
 ('00000000-0000-4000-8000-000000000802'::uuid,(select id from original_events where user_id='00000000-0000-4000-8000-000000000801'),null::uuid,'pending'),
 ('00000000-0000-4000-8000-000000000801'::uuid,gen_random_uuid(),null::uuid,'pending'),
 ('00000000-0000-4000-8000-000000000801'::uuid,(select id from original_events where user_id='00000000-0000-4000-8000-000000000801'),gen_random_uuid(),'wish')
 ) invalid(owner,event_id,wish_id,kind);
select throws_ok($$update public.reward_allocations set wish_id='70000000-0000-4000-8000-000000000803' where allocation_type='wish'$$,
 '23503',null,'UPDATE cannot substitute a foreign Wish');
select throws_ok(format('update public.reward_allocations set reward_event_id=%L where user_id=%L',
 (select id from original_events where user_id='00000000-0000-4000-8000-000000000802'),'00000000-0000-4000-8000-000000000801'),
 '23503',null,'UPDATE cannot substitute a foreign Event');
select throws_ok($$update public.reward_allocations set user_id='00000000-0000-4000-8000-000000000802' where user_id='00000000-0000-4000-8000-000000000801'$$,
 '23503',null,'UPDATE cannot change owner while retaining foreign references');
select throws_ok($$delete from public.wishes where id='70000000-0000-4000-8000-000000000802'$$,
 '23503',null,'standalone Wish deletion cannot erase allocation provenance');
select throws_ok($$delete from public.reward_events where user_id='00000000-0000-4000-8000-000000000801'$$,
 '23503',null,'standalone Event deletion cannot orphan allocations');
select throws_ok($$update public.reward_events set source_type='MILESTONE_COMPLETED' where user_id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802')$$,'23514',null,'Milestone source remains disabled');
select throws_ok($$update public.reward_events set amount=8 where user_id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802')$$,'23514',null,'Daily-only +1 rule unchanged');

-- Future protected statuses are representable; no automatic unlock engine.
update public.wishes set status='unlocked',unlocked_at=clock_timestamp(),cover_path='wish-covers/fixture/cover.jpg',reference_price=123.45,why='Meaningful'
where id='70000000-0000-4000-8000-000000000802';
select lives_ok($$update public.wishes set status='redeemed',redeemed_at=clock_timestamp() where id='70000000-0000-4000-8000-000000000802'$$,
 'redeemed status and timestamps are representable without a redemption Command');
create temp table frozen_allocations as select id,to_jsonb(a) body from public.reward_allocations a
 where user_id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802');
create temp table frozen_wishes as select id,to_jsonb(w) body from public.wishes w
 where user_id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802');
grant select on original_events,frozen_allocations,frozen_wishes to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000801';
select is((select count(*)::integer from public.wishes),3,'A reads only three owned Wishes');
select is((select count(*)::integer from public.reward_allocations),5,'A reads only owned Allocations');
select is((select count(*)::integer from public.wishes where id='70000000-0000-4000-8000-000000000803'),0,'A cannot read B Wish by ID');
select is((select count(*)::integer from public.reward_events where user_id='00000000-0000-4000-8000-000000000802'),0,'Reward RLS remains isolated');
select throws_ok($$insert into public.wishes(user_id,title,target) values ('00000000-0000-4000-8000-000000000801','Client Wish',1)$$,'42501',null,'client cannot directly create Wish');
select throws_ok($$update public.wishes set status='redeemed'$$,'42501',null,'client cannot change Wish state');
select throws_ok($$delete from public.wishes$$,'42501',null,'client cannot delete Wish');
select throws_ok($$insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type) select user_id,id,1,'pending' from public.reward_events$$,
 '42501',null,'client cannot allocate even an owned reward');
select throws_ok($$update public.reward_allocations set amount=-100$$,'42501',null,'client cannot forge corrections');
select throws_ok($$delete from public.reward_allocations$$,'42501',null,'client cannot erase allocation history');

select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date,'10000000-0000-4000-8000-000000000801',false);
select ok((select status='reversed' and amount=1 and reversed_at is not null from public.reward_events), 'Daily reversal works with referencing allocations');
select ok(not exists(select 1 from public.reward_allocations a join frozen_allocations f using(id) where to_jsonb(a)<>f.body),
 'terminal contributions retain their original signed history on reversal');
select ok(not exists(select 1 from public.wishes w join frozen_wishes f using(id) where to_jsonb(w)<>f.body),
 'Daily reversal does not relock or rewrite stored Wishes');
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date,'10000000-0000-4000-8000-000000000801',true);
select public.set_task_completion((clock_timestamp() at time zone 'UTC')::date,'10000000-0000-4000-8000-000000000801',true);
select is((select count(*)::integer from public.reward_events),1,'Daily reactivation/retry reuses the same source');
select is((select to_jsonb(e) from public.reward_events e),(select body from original_events where user_id='00000000-0000-4000-8000-000000000801'),
 'reactivation restores original Event identity/time/amount');
select is((select count(*)::integer from public.reward_allocations),5,'Daily retries create no new Allocations');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000802';
select is((select count(*)::integer from public.wishes),2,'B reads only two owned Wishes');
select is((select count(*)::integer from public.reward_allocations),1,'B reads only its Pending allocation');
select is((select count(*)::integer from public.reward_allocations where user_id='00000000-0000-4000-8000-000000000801'),0,'B cannot read A allocations');
set local request.jwt.claim.sub='';
select is((select count(*)::integer from public.wishes),0,'missing identity sees no Wishes');
select is((select count(*)::integer from public.reward_allocations),0,'missing identity sees no Allocations');
set local role anon;
select throws_ok($$select * from public.wishes$$,'42501',null,'anonymous Wish read denied');
select throws_ok($$select * from public.reward_allocations$$,'42501',null,'anonymous Allocation read denied');
select throws_ok($$select * from public.reward_events$$,'42501',null,'anonymous Reward read remains denied');
reset role;

-- Cleanup all owned relations together; NO ACTION must not block owner removal.
delete from auth.users where id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802');
select is((select count(*)::integer from auth.users where id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802')),0,'test users removed');
select is((select count(*)::integer from public.profiles where id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802')),0,'test profiles removed');
select is(count(owned.user_id)::integer,0,tables.table_name || ' fixture cleanup complete') from (
 select 'wishes' table_name,user_id from public.wishes union all
 select 'reward_allocations',user_id from public.reward_allocations union all
 select 'reward_events',user_id from public.reward_events union all
 select 'daily_plans',user_id from public.daily_plans union all
 select 'daily_plan_items',user_id from public.daily_plan_items union all
 select 'tasks',user_id from public.tasks union all
 select 'planning_items',user_id from public.planning_items union all
 select 'user_settings',user_id from public.user_settings
 ) owned right join (values ('wishes'),('reward_allocations'),('reward_events'),('daily_plans'),('daily_plan_items'),('tasks'),('planning_items'),('user_settings')) tables(table_name)
 on owned.table_name=tables.table_name and owned.user_id in ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000802')
 group by tables.table_name;
select * from finish();
rollback;

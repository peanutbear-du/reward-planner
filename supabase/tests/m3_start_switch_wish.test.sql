-- DISPOSABLE / ISOLATED DATABASE ONLY, with migrations and pgTAP already installed.
-- Contains a transaction-local fault trigger. NEVER execute on shared Dev.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '5s';
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-000000000b01', 'm3-start-a@example.test'),
 ('00000000-0000-4000-8000-000000000b02', 'm3-start-b@example.test');

-- Real qualification/reward triggers create the source; no fake +N Event.
create function pg_temp.daily(p_owner uuid, p_date date) returns uuid language plpgsql as $$
declare v_plan uuid; v_task uuid; v_event uuid;
begin
 insert into public.tasks(user_id,title) values(p_owner,'Daily fixture') returning id into v_task;
 insert into public.daily_plans(user_id,plan_date,status,snapshot_created_at)
 values(p_owner,p_date,'committed',clock_timestamp()) returning id into v_plan;
 insert into public.daily_plan_items(user_id,daily_plan_id,task_id,title_snapshot,result_status,completed_at_on_day)
 values(p_owner,v_plan,v_task,'Frozen fixture','completed',clock_timestamp());
 select id into strict v_event from public.reward_events where user_id=p_owner and source_id=v_plan;
 return v_event;
end;
$$;
create function pg_temp.reverse_event(p_event uuid, p_complete boolean) returns void language plpgsql as $$
begin
 update public.daily_plan_items set result_status=case when p_complete then 'completed' else 'pending' end,
 completed_at_on_day=case when p_complete then clock_timestamp() else null end
 where daily_plan_id=(select source_id from public.reward_events where id=p_event);
end;
$$;
create function pg_temp.act(p_owner uuid, p_wish uuid, p_switch boolean default false) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform set_config('request.jwt.claim.sub',p_owner::text,true);
 if p_switch then r:=public.switch_wish(p_wish); else r:=public.start_wish(p_wish); end if;
 return r;
end;
$$;
create function pg_temp.reward_snapshot(p_event uuid) returns jsonb language sql as $$
 select jsonb_build_object(
  'event', (select to_jsonb(e) from public.reward_events e where e.id=p_event),
  'allocations', (select jsonb_agg(to_jsonb(a) order by a.id) from public.reward_allocations a where a.reward_event_id=p_event),
  'corrections', (select jsonb_agg(to_jsonb(c) order by c.id) from public.reward_event_corrections c where c.reward_event_id=p_event)
 );
$$;

create function pg_temp.balanced(p_owner uuid) returns boolean language sql as $$
 select not exists (
  select 1 from public.reward_events e left join public.reward_allocations a on a.reward_event_id=e.id and a.user_id=e.user_id
  left join public.wishes w on w.id=a.wish_id and w.user_id=a.user_id
  where e.user_id=p_owner group by e.id,e.amount,e.status
  having (e.status='active' and coalesce(sum(a.amount),0)<>e.amount)
    or (e.status='reversed' and coalesce(sum(a.amount) filter(where a.allocation_type='pending' or w.status in ('wishlist','unlocking')),0)<>0)
 ) and not exists(select 1 from public.reward_allocations where user_id=p_owner group by reward_event_id,allocation_type,wish_id having sum(amount)<0);
$$;

select ok((select prosecdef and proconfig && array['search_path=','search_path=""'] from pg_proc where oid='public.start_wish(uuid)'::regprocedure), 'Start definer / empty path');
select ok(has_function_privilege('authenticated','public.start_wish(uuid)','EXECUTE'), 'authenticated Start');
select ok(has_function_privilege('authenticated','public.switch_wish(uuid)','EXECUTE'), 'authenticated Switch');
select ok(not has_function_privilege('anon','public.start_wish(uuid)','EXECUTE'), 'anon refused');
select ok(not exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid in ('public.start_wish(uuid)'::regprocedure,'public.switch_wish(uuid)'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE'), 'no PUBLIC Execute');
select ok(not has_function_privilege('authenticated',f,'EXECUTE') and not has_function_privilege('service_role',f,'EXECUTE'), 'internal function denied: '||f)
from (values ('public.lock_wish_reward_user(uuid)'),('public.assert_wish_reward_history(uuid)'),('public.prepare_wish_rewards(uuid)'),
 ('public.apply_wish_pending(uuid,uuid)'),('public.change_current_wish(uuid,boolean)'),('public.wish_lifecycle_json(uuid,uuid)'),('public.sync_daily_reward_event(uuid,uuid)')) t(f);
select ok(not has_table_privilege('authenticated','public.wish_reward_state','SELECT,INSERT,UPDATE,DELETE'), 'processing markers private');
select ok(not has_table_privilege('authenticated','public.reward_allocations','INSERT,UPDATE,DELETE'), 'clients cannot allocate');

insert into public.wishes(id,user_id,title,target) values
 ('70000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-000000000b01','A',10),
 ('70000000-0000-4000-8000-000000000b02','00000000-0000-4000-8000-000000000b01','B',10),
 ('70000000-0000-4000-8000-000000000b03','00000000-0000-4000-8000-000000000b01','Exact',1),
 ('70000000-0000-4000-8000-000000000b04','00000000-0000-4000-8000-000000000b01','Overflow',1),
 ('70000000-0000-4000-8000-000000000b05','00000000-0000-4000-8000-000000000b02','Foreign',10);
create temp table replies(body jsonb);
insert into replies values(pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01'));
select is((select body#>>'{data,pendingApplied}' from replies limit 1),'0','zero Pending starts normally');
select ok((select status='unlocking' and started_at is not null from public.wishes where id='70000000-0000-4000-8000-000000000b01'),'first start persisted');
create temp table first_start as select started_at,updated_at from public.wishes where id='70000000-0000-4000-8000-000000000b01';
select is(pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01')#>>'{data,changed}','false','same target Start no-op');
select is(pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01',true)#>'{effects}','[]'::jsonb,'same target Switch no-op');
select ok((select (w.started_at,w.updated_at)=(s.started_at,s.updated_at) from public.wishes w cross join first_start s where w.id='70000000-0000-4000-8000-000000000b01'),'retry preserves timestamps');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b02',true);
select throws_ok($$select public.start_wish('70000000-0000-4000-8000-000000000b01')$$,'P0002','WISH_NOT_FOUND','authenticated caller cannot start foreign Wish');
select throws_ok($$select public.prepare_wish_rewards('00000000-0000-4000-8000-000000000b02')$$,'42501',null,'authenticated caller cannot call kernel');
select throws_ok($$select * from public.wish_reward_state$$,'42501',null,'marker rows not exposed to user clients');
reset role;
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b02')$$,'P0001','WISH_ALREADY_UNLOCKING','Start requires explicit switch');
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b05')$$,'P0002','WISH_NOT_FOUND','foreign target hidden');
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b99')$$,'P0002','WISH_NOT_FOUND','missing target same error');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.start_wish('70000000-0000-4000-8000-000000000b01')$$,'42501','AUTHENTICATION_REQUIRED','identity required');

create temp table sources(label text primary key,id uuid);
insert into sources values('first',pg_temp.daily('00000000-0000-4000-8000-000000000b01','2026-01-01'));
select is((public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01')->>'progress')::int,1,'Daily flows into current Wish');
create temp table original_event as select e.* from public.reward_events e join sources s on s.id=e.id;

-- RP-M3-07: an active Wish loses the credited point and the same source can reactivate.
select pg_temp.reverse_event((select id from sources where label='first'),false);
select is((public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01')->>'progress')::int,
 0,'Daily reversal reduces the current Wish progress');
select is((select status from public.wishes where id='70000000-0000-4000-8000-000000000b01'),
 'unlocking','Daily reversal keeps the current Wish Unlocking');
select is((select amount from public.reward_allocations
 where reward_event_id=(select id from sources where label='first') and entry_key='reverse:70000000-0000-4000-8000-000000000b01'),
 -1,'progress correction is a signed allocation tied to the original Event');
select is((select array_agg(c.status) from public.reward_event_corrections c
 join original_event o on (c.reward_event_id,c.user_id)=(o.id,o.user_id)),
 array['reversed']::text[],'first reversal adds one correction on the original Event');
create temp table first_reversed as select pg_temp.reward_snapshot(id) body from original_event;
select pg_temp.reverse_event((select id from sources where label='first'),false);
select is((select pg_temp.reward_snapshot(id) from original_event),(select body from first_reversed),
 'repeated reversal leaves Event, allocations and corrections unchanged');

select pg_temp.reverse_event((select id from sources where label='first'),true);
select is((public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01')->>'progress')::int,
 1,'reactivation restores the current Wish progress once');
select is((select array_agg(c.status order by c.status) from public.reward_event_corrections c
 join original_event o on (c.reward_event_id,c.user_id)=(o.id,o.user_id)),
 array['active','reversed']::text[],'reactivation retains exactly one row for each transition');
select ok((select e.status='active' and e.reversed_at is null and (e.amount,e.created_at)=(o.amount,o.created_at)
 from public.reward_events e join original_event o using(id)),'reactivation clears reversed_at and preserves source identity');
create temp table first_reactivated as select pg_temp.reward_snapshot(id) body from original_event;
select pg_temp.reverse_event((select id from sources where label='first'),true);
select is((select pg_temp.reward_snapshot(id) from original_event),(select body from first_reactivated),
 'repeated completion leaves Event, allocations and corrections unchanged');
select is((select count(*)::int from public.reward_events e join original_event o
 on (e.user_id,e.source_type,e.source_id)=(o.user_id,o.source_type,o.source_id)),1,'repeats do not create another Daily Event');

select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b02',true);
select is((public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01')->>'progress')::int,1,'switch preserves old progress');
select pg_temp.reverse_event((select id from sources where label='first'),false);
select is((public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01')->>'progress')::int,0,'reversal removes paused Wishlist contribution');
select pg_temp.reverse_event((select id from sources where label='first'),true);
select is((public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b02')->>'progress')::int,1,'reactivated entitlement goes to current B');
select ok((select (e.id,e.amount,e.created_at)=(o.id,o.amount,o.created_at) from public.reward_events e join original_event o using(id)),'Event identity amount time unchanged');
select is((select array_agg(c.status order by c.status) from public.reward_event_corrections c
 join original_event o on (c.reward_event_id,c.user_id)=(o.id,o.user_id)),
 array['active','active','reversed','reversed']::text[],'both cycles remain recorded on the same Event');
select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b01',true);
select is((select started_at from public.wishes where id='70000000-0000-4000-8000-000000000b01'),(select started_at from first_start),'resume keeps first started_at');
select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b03',true);
insert into sources values('protected',pg_temp.daily('00000000-0000-4000-8000-000000000b01','2026-01-02'));
select ok((select status='unlocked' and unlocked_at is not null from public.wishes where id='70000000-0000-4000-8000-000000000b03'),'exact Daily unlocks');
select pg_temp.reverse_event((select id from sources where label='protected'),false);
select is((select status from public.wishes where id='70000000-0000-4000-8000-000000000b03'),
 'unlocked','Wish stays Unlocked while its Event is reversed');
select ok((select c.created_at=e.reversed_at from public.reward_event_corrections c
 join public.reward_events e on (e.id,e.user_id)=(c.reward_event_id,c.user_id)
 where c.reward_event_id=(select id from sources where label='protected') and c.status='reversed'),
 'terminal correction records the actual reversal time');
select pg_temp.reverse_event((select id from sources where label='protected'),true);
select is((select count(distinct status)::int from public.reward_event_corrections
 where reward_event_id=(select id from sources where label='protected')),2,
 'both terminal transitions remain traceable after reactivation');
select is((public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b03')->>'progress')::int,1,'terminal contribution retained');
select is((select coalesce(sum(amount),0) from public.reward_allocations where reward_event_id=(select id from sources where label='protected') and allocation_type='pending'),0::bigint,'reactivation cannot mint spent Pending');
select ok(has_table_privilege('authenticated','public.reward_event_corrections','SELECT')
 and not has_table_privilege('authenticated','public.reward_event_corrections','INSERT,UPDATE,DELETE,TRUNCATE'),
 'correction history is read-only for authenticated clients');
select ok(has_table_privilege('service_role','public.reward_event_corrections','SELECT')
 and not has_table_privilege('service_role','public.reward_event_corrections','INSERT,UPDATE,DELETE,TRUNCATE'),
 'service role can verify cleanup but has no direct write grant');
select ok(not has_table_privilege('anon','public.reward_event_corrections','SELECT'), 'anon cannot read correction history');
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b03')$$,'P0001','WISH_START_NOT_ALLOWED','immediate unlock retry conflicts');
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b04',true)$$,'P0001','WISH_NOT_UNLOCKING','Switch requires current');
select set_config('request.jwt.claim.sub','',true);
insert into sources values('overflow1',pg_temp.daily('00000000-0000-4000-8000-000000000b01','2026-01-03')),
 ('overflow2',pg_temp.daily('00000000-0000-4000-8000-000000000b01','2026-01-04'));
create temp table overflow_reply as select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b04') body;
select is((select body#>>'{data,pendingApplied}' from overflow_reply),'1','applies only target remainder');
select is((select body#>>'{data,pendingRemaining}' from overflow_reply),'1','overflow retained');
select is((select body#>'{data,currentWishId}' from overflow_reply),'null'::jsonb,'unlock leaves no current Wish');
select is((select sum(a.amount) from public.reward_allocations a join sources s on s.id=a.reward_event_id where s.label='overflow1' and a.allocation_type='wish'),1::bigint,'oldest Event consumed first');
select ok(pg_temp.balanced('00000000-0000-4000-8000-000000000b01'),'source invariants after transitions');
-- Reactivation with no current returns only the unprotected original source to Pending.
select pg_temp.reverse_event((select id from sources where label='first'),false);
select pg_temp.reverse_event((select id from sources where label='first'),true);
select is((select sum(amount) from public.reward_allocations where reward_event_id=(select id from sources where label='first') and allocation_type='pending'),1::bigint,'no-current reactivation goes to Pending');
insert into public.wishes(id,user_id,title,target) values
 ('70000000-0000-4000-8000-000000000b07','00000000-0000-4000-8000-000000000b01','Pending exact',2);
create temp table exact_reply as select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b07') body;
select is((select body#>>'{data,wish,status}' from exact_reply),'unlocked','exact Pending unlocks during Start');
select is((select body#>>'{data,pendingRemaining}' from exact_reply),'0','exact Pending leaves zero');
create temp table exact_before as select count(*) n from public.reward_allocations where user_id='00000000-0000-4000-8000-000000000b01';
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b07')$$,'P0001','WISH_START_NOT_ALLOWED','Start-immediate-unlock retry conflicts');
select is((select count(*) from public.reward_allocations where user_id='00000000-0000-4000-8000-000000000b01'),(select n from exact_before),'terminal retry leaves ledger intact');
update public.wishes set status='redeemed',redeemed_at=clock_timestamp() where id='70000000-0000-4000-8000-000000000b07';
create temp table redeemed_before as
 select public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b07') wish,
 pg_temp.reward_snapshot(id)->'allocations' allocations from original_event;
select pg_temp.reverse_event((select id from sources where label='first'),false);
select is(public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b07'),
 (select wish from redeemed_before),'reversal preserves Redeemed status, progress and timestamps');
select ok(pg_temp.balanced('00000000-0000-4000-8000-000000000b01'),'protected reversed source conserved');
select pg_temp.reverse_event((select id from sources where label='first'),true);
select is(public.wish_lifecycle_json('00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b07'),
 (select wish from redeemed_before),'reactivation preserves the Redeemed Wish');
select is((select pg_temp.reward_snapshot(id)->'allocations' from original_event),
 (select allocations from redeemed_before),'protected cycle adds no allocation or Pending credit');
select is((select array_agg(c.status order by c.status) from public.reward_event_corrections c
 join original_event o on (c.reward_event_id,c.user_id)=(o.id,o.user_id)),
 array['active','active','active','active','reversed','reversed','reversed','reversed']::text[],
 'the Redeemed cycle is traceable on the original Event even without an allocation change');

-- RP-M3-06: a new Daily source after unlock belongs to Pending.
select set_config('request.jwt.claim.sub','',true);
create temp table unlocked_before_new_daily as
 select public.wish_lifecycle_json(
  '00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b03') as body;
insert into sources values('post-unlock',pg_temp.daily('00000000-0000-4000-8000-000000000b01','2026-01-05'));
select is((select coalesce(sum(amount),0) from public.reward_allocations
 where reward_event_id=(select id from sources where label='post-unlock') and allocation_type='pending'),
 1::bigint,'new Daily reward after unlock goes entirely to Pending');
select is((select count(*)::int from public.reward_allocations
 where reward_event_id=(select id from sources where label='post-unlock') and wish_id is not null),
 0,'new Daily reward has no Wish allocation after unlock');
select is(public.wish_lifecycle_json(
 '00000000-0000-4000-8000-000000000b01','70000000-0000-4000-8000-000000000b03'),
 (select body from unlocked_before_new_daily),'new Daily reward leaves the Unlocked Wish unchanged');

-- Simulate pre-M3-04 history only for the fresh second owner.
select set_config('request.jwt.claim.sub','',true);
insert into sources values('legacy',pg_temp.daily('00000000-0000-4000-8000-000000000b02','2026-01-01'));
delete from public.reward_allocations where user_id='00000000-0000-4000-8000-000000000b02';
delete from public.wish_reward_state where user_id='00000000-0000-4000-8000-000000000b02';
create temp table legacy_reply as select pg_temp.act('00000000-0000-4000-8000-000000000b02','70000000-0000-4000-8000-000000000b05') body;
select is((select body#>>'{data,pendingApplied}' from legacy_reply),'1','legacy active gap lazily initialized and consumed');
create temp table ledger_before as select to_jsonb(a) body from public.reward_allocations a where user_id='00000000-0000-4000-8000-000000000b02';
select pg_temp.act('00000000-0000-4000-8000-000000000b02','70000000-0000-4000-8000-000000000b05');
select is((select jsonb_agg(body order by body->>'id') from ledger_before),(select jsonb_agg(to_jsonb(a) order by a.id) from public.reward_allocations a where user_id='00000000-0000-4000-8000-000000000b02'),'retry leaves ledger unchanged');
select ok(pg_temp.balanced('00000000-0000-4000-8000-000000000b02'),'legacy source balanced');
select throws_ok($$insert into public.wish_reward_state(reward_event_id,user_id,last_status)
 select id,'00000000-0000-4000-8000-000000000b01','active' from sources where label='legacy'$$,'23505',null,'source marker primary key prevents duplicate initialization');
select throws_ok($$update public.wish_reward_state set user_id='00000000-0000-4000-8000-000000000b01'
 where reward_event_id=(select id from sources where label='legacy')$$,'23503',null,'marker cannot reference another owner source');
select throws_ok($$insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type,source_revision,entry_key)
 select user_id,reward_event_id,amount,allocation_type,source_revision,entry_key from public.reward_allocations
 where reward_event_id=(select id from sources where label='legacy') and entry_key='credit'$$,'23505',null,'source/revision/entry unique key prevents duplicate credit');
-- Lazy reversed sources must not become spendable, including a prior raw Pending row.
select set_config('request.jwt.claim.sub','',true);
insert into sources values('legacy-reversed',pg_temp.daily('00000000-0000-4000-8000-000000000b02','2026-01-03'));
select pg_temp.reverse_event((select id from sources where label='legacy-reversed'),false);
delete from public.wish_reward_state where reward_event_id=(select id from sources where label='legacy-reversed');
select public.prepare_wish_rewards('00000000-0000-4000-8000-000000000b02');
select is((select coalesce(sum(amount),0) from public.reward_allocations where reward_event_id=(select id from sources where label='legacy-reversed')),0::bigint,'legacy reversed creates no entitlement');

-- Both owners have correction rows so this also exercises positive access for B.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b01',true);
select ok((select count(*) > 0 and bool_and(user_id=auth.uid()) from public.reward_event_corrections),
 'A sees its own history and none of B history');
select throws_ok($$update public.reward_event_corrections set status='active' where false$$,
 '42501',null,'authenticated clients cannot update correction history');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000b02',true);
select ok((select count(*)=1 and bool_and(user_id=auth.uid()) from public.reward_event_corrections),
 'B sees its own history and none of A history');
reset role;
select throws_ok($$insert into public.reward_event_corrections(user_id,reward_event_id,status,created_at)
 select '00000000-0000-4000-8000-000000000b02',id,'reversed',clock_timestamp() from original_event$$,
 '23503',null,'a correction cannot refer to a foreign Event');

-- Mid-transaction fault AFTER switching and AFTER pending -x, before Wish +x.
-- This hook is rolled back and is ONLY for disposable databases.
select set_config('request.jwt.claim.sub','',true);
insert into public.wishes(id,user_id,title,target) values
 ('70000000-0000-4000-8000-000000000b06','00000000-0000-4000-8000-000000000b02','Fault target',10);
insert into sources values('rollback',pg_temp.daily('00000000-0000-4000-8000-000000000b02','2026-01-02'));
-- Reconstruct a valid, unallocated legacy source so the failed command also initializes a marker.
delete from public.reward_allocations where reward_event_id=(select id from sources where label='rollback');
delete from public.wish_reward_state where reward_event_id=(select id from sources where label='rollback');
create temp table before_fault as
 select 'wish' kind,id,to_jsonb(w) body from public.wishes w where user_id='00000000-0000-4000-8000-000000000b02' union all
 select 'allocation',id,to_jsonb(a) from public.reward_allocations a where user_id='00000000-0000-4000-8000-000000000b02' union all
 select 'state',reward_event_id,to_jsonb(s) from public.wish_reward_state s where user_id='00000000-0000-4000-8000-000000000b02';
create function pg_temp.fail_wish_credit() returns trigger language plpgsql as $$
begin
 if new.wish_id='70000000-0000-4000-8000-000000000b06' then raise exception 'TEST_FAULT' using errcode='P0001'; end if;
 return new;
end;
$$;
create trigger m3_start_isolated_test_fault before insert on public.reward_allocations for each row execute function pg_temp.fail_wish_credit();
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b02','70000000-0000-4000-8000-000000000b06',true)$$,'P0001','TEST_FAULT','fault interrupts partial transfer');
select is((select jsonb_agg(to_jsonb(b) order by kind,id) from before_fault b),
 (select jsonb_agg(to_jsonb(b) order by kind,id) from (
 select 'wish' kind,id,to_jsonb(w) body from public.wishes w where user_id='00000000-0000-4000-8000-000000000b02' union all
 select 'allocation',id,to_jsonb(a) from public.reward_allocations a where user_id='00000000-0000-4000-8000-000000000b02' union all
 select 'state',reward_event_id,to_jsonb(s) from public.wish_reward_state s where user_id='00000000-0000-4000-8000-000000000b02') b), 'Wish time/status, paired entries and initialization marker all rolled back');
drop trigger m3_start_isolated_test_fault on public.reward_allocations;

-- Invalid legacy history must reject, not be silently balanced.
insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type)
 select '00000000-0000-4000-8000-000000000b02',id,-1,'pending' from sources where label='rollback';
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b02','70000000-0000-4000-8000-000000000b06',true)$$,'P0001','REWARD_ALLOCATION_INCONSISTENT','negative legacy target refused');
delete from public.reward_allocations where reward_event_id=(select id from sources where label='rollback') and amount=-1;
insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type)
 select '00000000-0000-4000-8000-000000000b02',id,2,'pending' from sources where label='rollback';
select throws_ok($$select pg_temp.act('00000000-0000-4000-8000-000000000b02','70000000-0000-4000-8000-000000000b06',true)$$,'P0001','REWARD_ALLOCATION_INCONSISTENT','source over-allocation refused without balancing');
select set_config('request.jwt.claim.sub','',true);
delete from auth.users where id in ('00000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-000000000b02');
select is((select count(*)::int from public.reward_event_corrections where user_id in ('00000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-000000000b02')),0,'owner cleanup includes correction history');
select is((select count(*)::int from public.wish_reward_state where user_id in ('00000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-000000000b02')),0,'owner cleanup includes processing markers');
select is((select count(*)::int from public.reward_allocations where user_id in ('00000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-000000000b02')),0,'owner cleanup includes allocations');
select * from finish();
rollback;

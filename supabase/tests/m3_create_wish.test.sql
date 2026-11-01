-- After Migration Review/application, on an explicitly approved test database.
-- Isolated fixture owners; no failure hooks. This file is not run by this ticket.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select prosecdef and proconfig=array['search_path=""']::text[]
 or prosecdef and proconfig=array['search_path=']::text[]
 from pg_proc where oid='public.create_wish(text,integer,numeric,text)'::regprocedure),
 'creation uses SECURITY DEFINER with empty search_path');
select ok(has_function_privilege('authenticated','public.create_wish(text,integer,numeric,text)','EXECUTE'), 'authenticated can execute');
select ok(not has_function_privilege(role_name::name,'public.create_wish(text,integer,numeric,text)','EXECUTE'), role_name || ' cannot execute')
from (values ('anon'),('service_role')) roles(role_name);
select ok(not has_table_privilege('authenticated','public.wishes',operation),'client cannot directly ' || operation)
from (values ('INSERT'),('UPDATE'),('DELETE')) operations(operation);

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000901','m3-create-a@example.test'),
 ('00000000-0000-4000-8000-000000000902','m3-create-b@example.test');
-- Real existing reward and Pending fixture: creation must not consume either.
insert into public.tasks(id,user_id,title) values
 ('10000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000901','Existing Task');
insert into public.daily_plans(id,user_id,plan_date,status,snapshot_created_at) values
 ('50000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000901',date '2026-09-21','committed',now());
insert into public.daily_plan_items(user_id,daily_plan_id,task_id,title_snapshot,result_status,completed_at_on_day) values
 ('00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','Frozen','completed',now());
insert into public.reward_allocations(user_id,reward_event_id,amount,allocation_type)
select user_id,id,1,'pending' from public.reward_events where user_id='00000000-0000-4000-8000-000000000901';
insert into public.wishes(id,user_id,title,target,status,started_at) values
 ('70000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000901','Existing current',60,'unlocking',now());
create temp table frozen_rows as
 select 'reward_events' table_name,id,to_jsonb(e) body from public.reward_events e where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'reward_allocations',id,to_jsonb(a) from public.reward_allocations a where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'daily_plans',id,to_jsonb(p) from public.daily_plans p where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'daily_plan_items',id,to_jsonb(i) from public.daily_plan_items i where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'tasks',id,to_jsonb(t) from public.tasks t where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'wishes',id,to_jsonb(w) from public.wishes w where id='70000000-0000-4000-8000-000000000901';
grant select on frozen_rows to authenticated;

set local role authenticated;
set local request.jwt.claim.sub='';
select throws_ok($$select public.create_wish('No identity',1)$$,'42501','AUTHENTICATION_REQUIRED','identity required');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000901';
create temp table first_create as select public.create_wish(' Camera ',137,123.45,' Learn photography ') body;
select is((select body->'wish'->>'title' from first_create),'Camera','trimmed title');
select is((select body->'wish'->>'why' from first_create),'Learn photography','trimmed Why');
select is((select body->'wish'->>'referencePrice' from first_create),'123.45','price metadata preserved separately from target');
select is((select (body->'wish'->>'target')::integer from first_create),137,'custom target preserved');
select ok((select body->'wish' @> '{"status":"wishlist","coverPath":null,"startedAt":null,"unlockedAt":null,"redeemedAt":null}'::jsonb from first_create),'only initial Wishlist state returned');
select is((select count(*)::integer from first_create,jsonb_object_keys(body->'wish')),12,'DTO has exactly twelve public fields');
select ok((select (body->'wish'->>'id')::uuid is not null and (body->'wish'->>'createdAt')::timestamptz is not null
 and (body->'wish'->>'updatedAt')::timestamptz is not null from first_create),'DTO identity and timestamps valid');
select ok((select to_jsonb(w)-'user_id'=jsonb_build_object(
 'id',w.id,'title',w.title,'target',w.target,'status',w.status,'cover_path',null,'started_at',null,'unlocked_at',null,'redeemed_at',null,
 'reference_price',w.reference_price,'why',w.why,'created_at',w.created_at,'updated_at',w.updated_at)
 from public.wishes w where id=(select (body->'wish'->>'id')::uuid from first_create)), 'persisted values match initial record');
select is((select user_id::text from public.wishes where id=(select (body->'wish'->>'id')::uuid from first_create)),
 '00000000-0000-4000-8000-000000000901','owner comes from auth.uid');
select ok(public.create_wish('Defaults',20)->'wish' @> '{"referencePrice":null,"why":null}'::jsonb,'two-argument defaults match adapter nulls');
select ok(public.create_wish('Zero price',2147483647,0,E' \t\n')->'wish' @> '{"referencePrice":0,"why":null}'::jsonb,'maximum integer target, zero price and blank Why supported');

-- All ECMAScript trim characters; interior whitespace must survive.
select is(public.create_wish(chr(code)||'Title'||chr(code),1,null,chr(code)||'Why'||chr(code))->'wish'->>'title','Title','ECMAScript title trim U+'||to_hex(code))
from unnest(array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) codes(code);
select is(public.create_wish('Title',1,null,chr(code)||'Why'||chr(code))->'wish'->>'why','Why','ECMAScript Why trim U+'||to_hex(code))
from unnest(array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) codes(code);
select ok(public.create_wish(E' A\tB ',1,null,E' C\nD ')->'wish' @> jsonb_build_object('title',E'A\tB','why',E'C\nD'),'interior whitespace retained');
select is(public.create_wish(chr(8203)||'A'||chr(8203),1)->'wish'->>'title',chr(8203)||'A'||chr(8203),'zero-width space is not trimmed');

create temp table before_invalid as select count(*) n from public.wishes;
select throws_ok(format('select public.create_wish(%L,1)',title),'22023','INVALID_WISH_REQUEST','invalid title rejected')
from (values (null::text),(''),(E'\t\n'),(U&'\00A0\FEFF')) invalid(title);
select throws_ok(format('select public.create_wish(%L,%L)','Title',target),'22023','INVALID_WISH_REQUEST','invalid target rejected')
from (values (null::integer),(0),(-1)) invalid(target);
select throws_ok(format('select public.create_wish(%L,1,%L::numeric)','Title',price),'22023','INVALID_WISH_REQUEST','invalid/nonfinite/unrepresentable price rejected')
from (values ('-1'),('NaN'),('Infinity'),('-Infinity'),('2e308')) invalid(price);
select throws_ok($$select public.create_wish('Title','1.5')$$,'22P02',null,'fractional text target rejected by integer argument');
select throws_ok($$select public.create_wish('Title','2147483648')$$,'22003',null,'oversized target rejected by integer argument');
select is((select count(*) from public.wishes),(select n from before_invalid),'failed calls leave no new Wishes');
create temp table repeated as select public.create_wish('Same name',40) body from generate_series(1,2);
select is((select count(distinct body->'wish'->>'id')::integer from repeated),2,'repeated calls create distinct identities, not fake idempotency');
select is((select count(*)::integer from public.wishes where status='unlocking'),1,'existing current Wish is not switched');
select throws_ok($$insert into public.wishes(user_id,title,target) values ('00000000-0000-4000-8000-000000000901','Direct',1)$$,'42501',null,'direct client insert stays denied');
grant select on first_create to authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000902';
select is((select count(*)::integer from public.wishes),0,'B cannot read A Wishes');
select ok(public.create_wish('B Wish',60)->'wish'->>'status'='wishlist','second owner creates independently');
select is((select count(*)::integer from public.wishes),1,'B reads only its own creation');
select pg_catalog.set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok($$select public.create_wish('Missing profile',1)$$,'23503',null,'profile FK cannot be bypassed by SECURITY DEFINER');
set local role anon;
select throws_ok($$select public.create_wish('Anonymous',1)$$,'42501',null,'anonymous cannot invoke even with a forged subject');
reset role;
set local request.jwt.claim.sub='';

select ok(not exists(select 1 from frozen_rows f left join (
 select 'reward_events' table_name,id,to_jsonb(e) body from public.reward_events e where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'reward_allocations',id,to_jsonb(a) from public.reward_allocations a where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'daily_plans',id,to_jsonb(p) from public.daily_plans p where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'daily_plan_items',id,to_jsonb(i) from public.daily_plan_items i where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'tasks',id,to_jsonb(t) from public.tasks t where user_id='00000000-0000-4000-8000-000000000901' union all
 select 'wishes',id,to_jsonb(w) from public.wishes w where id='70000000-0000-4000-8000-000000000901'
 ) current_rows using(table_name,id) where current_rows.body is distinct from f.body),'existing execution/reward/Pending/current Wish rows remain unchanged');
select is((select count(*)::integer from public.reward_allocations where user_id='00000000-0000-4000-8000-000000000901'),1,'no new allocation created');
select is((select count(*)::integer from public.reward_events where user_id='00000000-0000-4000-8000-000000000901'),1,'no new reward created');
delete from auth.users where id in ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000902');
select is((select count(*)::integer from public.wishes where user_id in ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000902')),0,'fixture Wishes cleaned by account removal');
select is((select count(*)::integer from public.profiles where id in ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000902')),0,'fixture profiles removed');
select * from finish();
rollback;

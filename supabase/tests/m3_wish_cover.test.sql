-- SQL-only checks after approved migration application. No real object fixtures:
-- live object upload/read/delete must use Storage API, never metadata DELETE.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select not public and name='wish-covers' and file_size_limit=5242880
 and allowed_mime_types=array['image/jpeg']::text[] from storage.buckets where id='wish-covers'), 'private JPEG-only 5 MiB bucket');
select ok((select relrowsecurity from pg_class where oid='storage.objects'::regclass), 'Storage object RLS enabled');
select ok((select prosecdef and proconfig[1] in ('search_path=','search_path=""') from pg_proc where oid='public.attach_wish_cover(uuid,uuid)'::regprocedure), 'narrow definer RPC has empty search_path');
select ok(has_function_privilege('service_role','public.attach_wish_cover(uuid,uuid)','EXECUTE'), 'server role may attach');
select ok(not has_function_privilege(role_name::name,'public.attach_wish_cover(uuid,uuid)','EXECUTE'),role_name||' cannot bypass byte validation via RPC')
from (values ('anon'),('authenticated')) roles(role_name);
select ok(not has_table_privilege('authenticated','public.wishes','UPDATE'), 'client still cannot update Wish directly');
select ok((select not polpermissive from pg_policy where polname=policy_name and polrelid='storage.objects'::regclass), policy_name||' cannot be bypassed by another permissive policy')
from (values ('wish_covers_select_guard'),('wish_covers_insert_guard'),('wish_covers_update_guard'),('wish_covers_delete_guard'),('wish_covers_anon_guard')) policies(policy_name);
select ok((select polcmd='r' and polpermissive from pg_policy where polname='wish_covers_select_own' and polrelid='storage.objects'::regclass), 'only owned private SELECT is added');

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000a01','m3-cover-a@example.test'),
 ('00000000-0000-4000-8000-000000000a02','m3-cover-b@example.test');
insert into public.wishes(id,user_id,title,target) values
 ('70000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a01','Owned A',20),
 ('70000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000a02','Owned B',20);
create temp table wish_before as select to_jsonb(w) body from public.wishes w where id='70000000-0000-4000-8000-000000000a01';
grant select on wish_before to authenticated,service_role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000a01';
select throws_ok($$select public.attach_wish_cover('70000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a01')$$,'42501',null,'own-user RPC bypass refused');
select throws_ok($$update public.wishes set cover_path='arbitrary' where id='70000000-0000-4000-8000-000000000a01'$$,'42501',null,'direct cover UPDATE refused');
select is((select count(*)::integer from public.wishes where id='70000000-0000-4000-8000-000000000a02'),0,'foreign Wish remains invisible');
reset role;
set local role service_role;
set local request.jwt.claim.role='authenticated';
select throws_ok($$select public.attach_wish_cover('70000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a01')$$,'42501','COVER_SERVER_REQUIRED','function also checks server role claim');
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='';
select throws_ok($$select public.attach_wish_cover(null,'00000000-0000-4000-8000-000000000a01')$$,'22023','INVALID_COVER_REQUEST','null identity rejected');
select throws_ok($$select public.attach_wish_cover('70000000-0000-4000-8000-000000000a01',null)$$,'22023','INVALID_COVER_REQUEST','null owner rejected');
select throws_ok($$select public.attach_wish_cover('70000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a02')$$,'P0002','WISH_NOT_FOUND','server cannot mismatch Wish and owner');
select throws_ok($$select public.attach_wish_cover('70000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a01')$$,'P0001','COVER_OBJECT_INVALID','missing actual object cannot be associated');
select is((select to_jsonb(w) from public.wishes w where id='70000000-0000-4000-8000-000000000a01'),(select body from wish_before),'failed attachment preserves all Wish fields');
reset role;
-- Existing-path database fixture only; no Storage object is created or removed.
update public.wishes set cover_path='00000000-0000-4000-8000-000000000a01/70000000-0000-4000-8000-000000000a01.jpg' where id='70000000-0000-4000-8000-000000000a01';
set local role service_role;
select throws_ok($$select public.attach_wish_cover('70000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a01')$$,'P0001','WISH_COVER_EXISTS','existing cover is never overwritten');
reset role;
delete from auth.users where id in ('00000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a02');
select is((select count(*)::integer from public.wishes where user_id in ('00000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a02')),0,'fixture Wishes cascade cleaned');
select * from finish();
rollback;

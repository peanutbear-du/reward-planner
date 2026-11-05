-- Manual catalog audit on confirmed Supabase DEV only. No fixtures or DDL.
-- Execute separately via an approved SQL connection / Dev SQL Editor.
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'wish-covers';

select policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

select p.prosecdef, p.proconfig,
       pg_catalog.pg_get_functiondef(p.oid) as definition,
       exists (
         select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
         where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) as public_can_execute
from pg_catalog.pg_proc p
where p.oid = 'public.attach_wish_cover(uuid,uuid)'::regprocedure;

-- Effective privileges include inherited grants and PUBLIC. Owner/superusers
-- retain administration rights; only service_role is an intended API caller.
select r.rolname,
       pg_catalog.has_function_privilege(r.oid, 'public.attach_wish_cover(uuid,uuid)', 'EXECUTE') as effective_execute,
       pg_catalog.pg_has_role(r.oid, 'service_role', 'MEMBER') as service_membership,
       pg_catalog.pg_has_role(r.oid, 'service_role', 'USAGE') as inherited_service_privileges
from pg_catalog.pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role');

rollback;

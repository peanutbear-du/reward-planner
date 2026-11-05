-- RP-M3-03. Bytes are validated by Business API before server-only Storage writes.
BEGIN;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wish-covers', 'wish-covers', false, 5242880, array['image/jpeg']);

-- Private reads only after association, restricted to the exact owned filename.
create policy wish_covers_select_own on storage.objects for select to authenticated
using (bucket_id = 'wish-covers' and exists (
  select 1 from public.wishes w where w.user_id = (select auth.uid())
    and w.cover_path = storage.objects.name
    and storage.objects.name = w.user_id::text || '/' || w.id::text || '.jpg'
));
-- Restrictive guards also prevent unrelated permissive policies bypassing the
-- gateway's byte validation. Other buckets retain their existing policies.
create policy wish_covers_select_guard on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'wish-covers' or exists (
  select 1 from public.wishes w where w.user_id = (select auth.uid())
    and w.cover_path = storage.objects.name
    and storage.objects.name = w.user_id::text || '/' || w.id::text || '.jpg'
));
create policy wish_covers_insert_guard on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'wish-covers');
create policy wish_covers_update_guard on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'wish-covers') with check (bucket_id <> 'wish-covers');
create policy wish_covers_delete_guard on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'wish-covers');
create policy wish_covers_anon_guard on storage.objects as restrictive for all to anon
using (bucket_id <> 'wish-covers') with check (bucket_id <> 'wish-covers');

-- Caller is a server-only service client AFTER Bearer validation and an owned
-- Wish lookup using the user's client. No authenticated direct-link bypass.
create function public.attach_wish_cover(p_wish_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_wish public.wishes%rowtype;
  v_path text;
  v_metadata jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'COVER_SERVER_REQUIRED' using errcode = '42501';
  end if;
  if p_wish_id is null or p_user_id is null then
    raise exception 'INVALID_COVER_REQUEST' using errcode = '22023';
  end if;
  select w.* into v_wish from public.wishes w
  where w.id = p_wish_id and w.user_id = p_user_id for update;
  if not found then raise exception 'WISH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_wish.cover_path is not null then
    raise exception 'WISH_COVER_EXISTS' using errcode = 'P0001';
  end if;
  v_path := p_user_id::text || '/' || p_wish_id::text || '.jpg';
  select o.metadata into v_metadata from storage.objects o
  where o.bucket_id = 'wish-covers' and o.name = v_path for share;
  if not found or v_metadata->>'mimetype' is distinct from 'image/jpeg'
    or not (case when v_metadata->>'size' ~ '^[0-9]+$'
      then (v_metadata->>'size')::numeric between 1 and 5242880 else false end) then
    raise exception 'COVER_OBJECT_INVALID' using errcode = 'P0001';
  end if;
  update public.wishes w set cover_path = v_path, updated_at = clock_timestamp()
  where w.id = p_wish_id and w.user_id = p_user_id and w.cover_path is null;
  return pg_catalog.jsonb_build_object('wishId', p_wish_id, 'coverPath', v_path);
end;
$$;
revoke all on function public.attach_wish_cover(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.attach_wish_cover(uuid, uuid) to service_role;

COMMIT;

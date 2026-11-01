-- RP-M3-02: narrow authenticated creation command; no allocation/start/unlock.
BEGIN;

create function public.create_wish(
  p_title text,
  p_target integer,
  p_reference_price numeric default null,
  p_why text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  -- Exact ECMAScript String.trim() WhiteSpace + LineTerminator set, matching
  -- Zod .trim(). Do not replace with locale-dependent regex or default btrim.
  v_trim_chars constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_title text;
  v_why text;
  v_wish public.wishes%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  v_title := pg_catalog.btrim(p_title, v_trim_chars);
  v_why := nullif(pg_catalog.btrim(p_why, v_trim_chars), '');
  if v_title is null or v_title = '' or v_title !~ '[^[:space:]]'
    or p_target is null or p_target <= 0
    or (p_reference_price is not null and (
      p_reference_price::text in ('NaN', 'Infinity', '-Infinity')
      or p_reference_price < 0
      -- CreatedWishDto is a finite JavaScript number, not arbitrary precision.
      or p_reference_price > 1.7976931348623157e308::numeric
    )) then
    raise exception 'INVALID_WISH_REQUEST' using errcode = '22023';
  end if;

  -- Ownership comes only from auth.uid(); the existing FK requires a profile.
  -- Every call inserts a distinct Wish. No retry/deduplication or side effects.
  insert into public.wishes (
    user_id, title, target, reference_price, why, status,
    cover_path, started_at, unlocked_at, redeemed_at
  ) values (
    v_user_id, v_title, p_target, p_reference_price, v_why,
    'wishlist', null, null, null, null
  ) returning * into v_wish;

  return pg_catalog.jsonb_build_object('wish', pg_catalog.jsonb_build_object(
    'id', v_wish.id, 'title', v_wish.title, 'target', v_wish.target,
    'status', v_wish.status, 'coverPath', v_wish.cover_path,
    'startedAt', v_wish.started_at, 'unlockedAt', v_wish.unlocked_at,
    'redeemedAt', v_wish.redeemed_at,
    'referencePrice', v_wish.reference_price, 'why', v_wish.why,
    'createdAt', v_wish.created_at, 'updatedAt', v_wish.updated_at
  ));
end;
$$;

revoke all on function public.create_wish(text, integer, numeric, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_wish(text, integer, numeric, text)
  to authenticated;

COMMIT;

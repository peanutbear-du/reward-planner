-- RP-M3-04: Daily-only allocation kernel required by Start / Switch.
-- No historical DML/backfill. All reconciliation is owner-scoped and lazy.
BEGIN;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
-- Drain old Daily executions before replacing their reward synchronization.
lock table public.daily_plans in access exclusive mode;

create table public.wish_reward_state (
  reward_event_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_status text not null check (last_status in ('active', 'reversed')),
  revision integer not null default 1 check (revision > 0),
  initialized boolean not null default false,
  foreign key (reward_event_id, user_id) references public.reward_events(id, user_id) on delete no action
);
alter table public.wish_reward_state enable row level security;
revoke all on public.wish_reward_state from public, anon, authenticated;
grant select on public.wish_reward_state to service_role;

-- Legacy rows retain NULL metadata. Each new source/revision/entry is unique:
-- init/reactivate credit, reverse per target, and the two sides of a transfer.
alter table public.reward_allocations
  add column source_revision integer,
  add column entry_key text,
  add constraint reward_allocations_operation_check check (
    (source_revision is null and entry_key is null) or
    (source_revision is not null and source_revision > 0 and entry_key is not null and length(entry_key) between 1 and 150)
  ),
  add constraint reward_allocations_operation_key unique (reward_event_id, source_revision, entry_key);

create function public.lock_wish_reward_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'WISH_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- NO KEY UPDATE is compatible with FK KEY SHARE, unlike FOR UPDATE.
  perform p.id from public.profiles p where p.id = p_user_id for no key update;
  if not found then raise exception 'WISH_NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

create function public.assert_wish_reward_history(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Reject malformed legacy/history BEFORE adding any balancing entries.
  if exists (
    select 1 from public.reward_allocations x where x.user_id = p_user_id
    group by x.reward_event_id, x.allocation_type, x.wish_id having sum(x.amount) < 0
  ) or exists (
    select 1 from public.reward_events r left join public.reward_allocations x
      on x.reward_event_id = r.id and x.user_id = r.user_id
    where r.user_id = p_user_id group by r.id, r.amount
    having coalesce(sum(x.amount), 0) > r.amount or coalesce(sum(x.amount), 0) < 0
  ) or exists (
    select 1 from public.wishes w join public.reward_allocations x on x.wish_id = w.id and x.user_id = w.user_id
    where w.user_id = p_user_id group by w.id, w.target having sum(x.amount) > w.target or sum(x.amount) < 0
  ) or exists (
    select 1 from public.reward_events r join public.wish_reward_state s
      on s.reward_event_id = r.id and s.user_id = r.user_id
    left join public.reward_allocations x on x.reward_event_id = r.id and x.user_id = r.user_id
    left join public.wishes w on w.id = x.wish_id and w.user_id = x.user_id
    where r.user_id = p_user_id and s.initialized and s.last_status = r.status
    group by r.id, r.amount, r.status having
      (r.status = 'active' and coalesce(sum(x.amount), 0) <> r.amount) or
      (r.status = 'reversed' and coalesce(sum(x.amount) filter (
        where x.allocation_type = 'pending' or w.status in ('wishlist', 'unlocking')), 0) <> 0)
  ) then
    raise exception 'REWARD_ALLOCATION_INCONSISTENT' using errcode = 'P0001';
  end if;
end;
$$;

create function public.prepare_wish_rewards(p_user_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  a record;
  v_total bigint;
  v_unprotected bigint;
  v_revision integer;
  v_progress_changed boolean := false;
begin
  perform public.lock_wish_reward_user(p_user_id);
  -- No Plan/Task/Item locks below this point. Stable lock order for every owner.
  perform r.id from public.reward_events r where r.user_id = p_user_id order by r.id for update;
  perform s.reward_event_id from public.wish_reward_state s where s.user_id = p_user_id order by s.reward_event_id for update;
  insert into public.wish_reward_state(reward_event_id, user_id, last_status)
    select r.id, r.user_id, r.status from public.reward_events r where r.user_id = p_user_id order by r.id
    on conflict (reward_event_id) do nothing;
  perform w.id from public.wishes w where w.user_id = p_user_id order by w.id for update;
  perform x.id from public.reward_allocations x where x.user_id = p_user_id order by x.id for update;
  perform public.assert_wish_reward_history(p_user_id);
  for e in select r.id, r.status, r.amount, s.last_status, s.revision, s.initialized
    from public.reward_events r join public.wish_reward_state s on s.reward_event_id = r.id and s.user_id = r.user_id
    where r.user_id = p_user_id order by r.id
  loop
    select coalesce(sum(x.amount), 0), coalesce(sum(x.amount) filter (
      where x.allocation_type = 'pending' or w.status in ('wishlist', 'unlocking')), 0)
      into v_total, v_unprotected from public.reward_allocations x
      left join public.wishes w on w.id = x.wish_id and w.user_id = x.user_id
      where x.reward_event_id = e.id and x.user_id = p_user_id;
    if e.initialized then
      -- Validate the previously processed state, including before a transition.
      if (e.last_status = 'active' and v_total <> e.amount)
        or (e.last_status = 'reversed' and v_unprotected <> 0) then
        raise exception 'REWARD_ALLOCATION_INCONSISTENT' using errcode = 'P0001';
      end if;
      if e.last_status = e.status then continue; end if;
    end if;
    v_revision := e.revision + case when e.initialized then 1 else 0 end;
    if e.status = 'active' then
      -- First initialization or reactivation: retained terminal contributions
      -- still consume the original source. Never mint another full reward.
      if v_total < e.amount then
        insert into public.reward_allocations(user_id, reward_event_id, amount, allocation_type, source_revision, entry_key)
        values(p_user_id, e.id, (e.amount - v_total)::integer, 'pending', v_revision, 'credit');
      end if;
    else
      for a in select x.allocation_type, x.wish_id, sum(x.amount) as amount
        from public.reward_allocations x left join public.wishes w on w.id = x.wish_id and w.user_id = x.user_id
        where x.reward_event_id = e.id and x.user_id = p_user_id
          and (x.allocation_type = 'pending' or w.status in ('wishlist', 'unlocking'))
        group by x.allocation_type, x.wish_id having sum(x.amount) > 0
        order by x.wish_id nulls first
      loop
        insert into public.reward_allocations(user_id, reward_event_id, wish_id, amount, allocation_type, source_revision, entry_key)
        values(p_user_id, e.id, a.wish_id, -a.amount::integer, a.allocation_type, v_revision,
          'reverse:' || coalesce(a.wish_id::text, 'pending'));
        if a.wish_id is not null then
          update public.wishes set updated_at = clock_timestamp() where id = a.wish_id and user_id = p_user_id;
          v_progress_changed := true;
        end if;
      end loop;
    end if;
    update public.wish_reward_state set initialized = true, last_status = e.status, revision = v_revision
      where reward_event_id = e.id and user_id = p_user_id;
  end loop;
  return v_progress_changed;
end;
$$;

create function public.apply_wish_pending(p_user_id uuid, p_wish_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_wish public.wishes%rowtype;
  v_progress bigint;
  v_applied integer := 0;
  v_take integer;
  e record;
begin
  -- Internal: caller has prepared/locked all sources and Wishes under the user lock.
  select * into strict v_wish from public.wishes where id = p_wish_id and user_id = p_user_id;
  if v_wish.status <> 'unlocking' then raise exception 'WISH_NOT_UNLOCKING' using errcode = 'P0001'; end if;
  select coalesce(sum(amount), 0) into v_progress from public.reward_allocations where wish_id = p_wish_id and user_id = p_user_id;
  if v_progress < 0 or v_progress > v_wish.target then
    raise exception 'REWARD_ALLOCATION_INCONSISTENT' using errcode = 'P0001';
  end if;
  for e in select r.id, s.revision, sum(x.amount) as pending
    from public.reward_events r join public.wish_reward_state s on s.reward_event_id = r.id and s.user_id = r.user_id
    join public.reward_allocations x on x.reward_event_id = r.id and x.user_id = r.user_id and x.allocation_type = 'pending'
    where r.user_id = p_user_id and r.status = 'active'
    group by r.id, r.created_at, s.revision having sum(x.amount) > 0 order by r.created_at, r.id
  loop
    exit when v_progress = v_wish.target;
    v_take := least(e.pending, v_wish.target - v_progress)::integer;
    insert into public.reward_allocations(user_id, reward_event_id, wish_id, amount, allocation_type, source_revision, entry_key) values
      (p_user_id, e.id, null, -v_take, 'pending', e.revision, 'move-out:' || p_wish_id::text),
      (p_user_id, e.id, p_wish_id, v_take, 'wish', e.revision, 'move-in:' || p_wish_id::text);
    v_progress := v_progress + v_take;
    v_applied := v_applied + v_take;
  end loop;
  if v_applied > 0 or v_progress = v_wish.target then
    update public.wishes set
      status = case when v_progress = target then 'unlocked' else status end,
      unlocked_at = case when v_progress = target then clock_timestamp() else unlocked_at end,
      updated_at = clock_timestamp()
    where id = p_wish_id and user_id = p_user_id;
  end if;
  return v_applied;
end;
$$;

create function public.wish_lifecycle_json(p_user_id uuid, p_wish_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', w.id, 'title', w.title, 'target', w.target, 'status', w.status, 'coverPath', w.cover_path,
    'startedAt', w.started_at, 'unlockedAt', w.unlocked_at, 'redeemedAt', w.redeemed_at,
    'updatedAt', w.updated_at, 'progress', (select coalesce(sum(x.amount), 0) from public.reward_allocations x where x.wish_id = w.id and x.user_id = p_user_id)
  ) from public.wishes w where w.id = p_wish_id and w.user_id = p_user_id;
$$;

create function public.change_current_wish(p_wish_id uuid, p_switch boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_wish public.wishes%rowtype;
  v_current uuid;
  v_previous uuid;
  v_applied integer := 0;
  v_remaining bigint;
  v_effects text[] := array[]::text[];
  v_changed boolean := false;
  v_progress_changed boolean;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_wish_id is null or p_switch is null then raise exception 'INVALID_WISH_START_REQUEST' using errcode = '22023'; end if;
  perform public.lock_wish_reward_user(v_user_id);
  select * into v_wish from public.wishes where id = p_wish_id and user_id = v_user_id;
  if not found then raise exception 'WISH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_wish.status in ('unlocked', 'redeemed') then raise exception 'WISH_START_NOT_ALLOWED' using errcode = 'P0001'; end if;
  select id into v_current from public.wishes where user_id = v_user_id and status = 'unlocking';
  perform public.assert_wish_reward_history(v_user_id);
  if v_current = p_wish_id and (exists (
    select 1 from public.reward_events r join public.reward_allocations x on x.reward_event_id = r.id and x.user_id = r.user_id
      left join public.wishes w on w.id = x.wish_id and w.user_id = x.user_id
    where r.user_id = v_user_id and r.status = 'reversed'
      and (x.allocation_type = 'pending' or w.status in ('wishlist', 'unlocking'))
    group by r.id having sum(x.amount) <> 0
  ) or exists (
    select 1 from public.reward_events r join public.wish_reward_state s on s.reward_event_id = r.id and s.user_id = r.user_id
    where r.user_id = v_user_id and s.initialized and s.last_status <> r.status
  )) then
    -- A true retry cannot repair stale privileged history while promising no writes.
    raise exception 'REWARD_ALLOCATION_INCONSISTENT' using errcode = 'P0001';
  end if;
  if v_current is distinct from p_wish_id then
    if not p_switch and v_current is not null then raise exception 'WISH_ALREADY_UNLOCKING' using errcode = 'P0001'; end if;
    if p_switch and v_current is null then raise exception 'WISH_NOT_UNLOCKING' using errcode = 'P0001'; end if;
    v_progress_changed := public.prepare_wish_rewards(v_user_id);
    -- Re-read after deterministic Wish locks (including concurrent cover writes).
    select * into strict v_wish from public.wishes where id = p_wish_id and user_id = v_user_id;
    v_previous := v_current;
    if v_previous is not null then
      update public.wishes set status = 'wishlist', updated_at = clock_timestamp() where id = v_previous and user_id = v_user_id;
      v_effects := array_append(v_effects, 'wish_switched');
    end if;
    v_effects := array_append(v_effects, case when v_wish.started_at is null then 'wish_started' else 'wish_resumed' end);
    update public.wishes set status = 'unlocking', started_at = coalesce(started_at, clock_timestamp()), updated_at = clock_timestamp()
      where id = p_wish_id and user_id = v_user_id;
    v_applied := public.apply_wish_pending(v_user_id, p_wish_id);
    if v_applied > 0 then v_effects := array_append(v_effects, 'pending_progress_applied'); end if;
    if v_applied > 0 or v_progress_changed then v_effects := array_append(v_effects, 'wish_progress_changed'); end if;
    if (select status = 'unlocked' from public.wishes where id = p_wish_id and user_id = v_user_id) then
      v_effects := array_append(v_effects, 'wish_unlocked');
    end if;
    v_changed := true;
  end if;
  -- Current-target retry does not initialize, consume, or update any timestamps.
  select id into v_current from public.wishes where user_id = v_user_id and status = 'unlocking';
  select coalesce(sum(x.amount), 0) into v_remaining from public.reward_allocations x
    join public.reward_events r on r.id = x.reward_event_id and r.user_id = x.user_id
    where x.user_id = v_user_id and x.allocation_type = 'pending' and r.status = 'active';
  return pg_catalog.jsonb_build_object('data', pg_catalog.jsonb_build_object(
    'changed', v_changed, 'wish', public.wish_lifecycle_json(v_user_id, p_wish_id),
    'previousWish', public.wish_lifecycle_json(v_user_id, v_previous), 'currentWishId', v_current,
    'pendingApplied', v_applied, 'pendingRemaining', v_remaining::text
  ), 'effects', to_jsonb(v_effects));
end;
$$;

create function public.start_wish(p_wish_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select public.change_current_wish(p_wish_id, false); $$;
create function public.switch_wish(p_wish_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select public.change_current_wish(p_wish_id, true); $$;

-- Preserve the existing Plan-first execution, qualifications and Event identity.
-- Acquire the user mutex BEFORE any Event write, never in a late Event trigger.
create or replace function public.sync_daily_reward_event(p_plan_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.daily_plans%rowtype;
  v_rows integer;
  v_current uuid;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'DAILY_PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_plan from public.daily_plans where id = p_plan_id and user_id = p_user_id for update;
  if not found then return; end if;
  perform public.lock_wish_reward_user(p_user_id);
  perform r.id from public.reward_events r where r.user_id = p_user_id order by r.id for update;
  if v_plan.status = 'committed' and v_plan.is_qualified then
    insert into public.reward_events(user_id, source_type, source_id, amount)
    values(p_user_id, 'DAILY_QUALIFIED', v_plan.id, 1)
    on conflict on constraint reward_events_source_key do update set status = 'active', reversed_at = null
      where reward_events.status = 'reversed';
  else
    update public.reward_events set status = 'reversed', reversed_at = clock_timestamp()
      where user_id = p_user_id and source_type = 'DAILY_QUALIFIED' and source_id = v_plan.id and status = 'active';
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;
  perform public.prepare_wish_rewards(p_user_id);
  if v_plan.status = 'committed' and v_plan.is_qualified then
    select id into v_current from public.wishes where user_id = p_user_id and status = 'unlocking';
    if v_current is not null then perform public.apply_wish_pending(p_user_id, v_current); end if;
  end if;
end;
$$;

revoke all on function public.lock_wish_reward_user(uuid), public.prepare_wish_rewards(uuid),
  public.assert_wish_reward_history(uuid),
  public.apply_wish_pending(uuid, uuid), public.wish_lifecycle_json(uuid, uuid),
  public.change_current_wish(uuid, boolean), public.sync_daily_reward_event(uuid, uuid),
  public.start_wish(uuid), public.switch_wish(uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_wish(uuid), public.switch_wish(uuid) to authenticated;
COMMIT;

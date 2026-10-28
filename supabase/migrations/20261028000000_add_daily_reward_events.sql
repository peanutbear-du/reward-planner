-- RP-M2-03: Daily Reward ledger only; allocation / Wishes / Milestones follow later.
-- Supabase applies each migration transactionally. Block concurrent plan writes
-- until the trigger and persisted-state backfill are both installed.
BEGIN;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
lock table public.daily_plans in access exclusive mode;

create table public.reward_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  amount integer not null,
  status text not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  constraint reward_events_source_key unique (user_id, source_type, source_id),
  -- Until the Milestone ticket adds its owned source relation, only Daily
  -- sources are supported. No unvalidated polymorphic source IDs are accepted.
  constraint reward_events_source_type_check check (source_type = 'DAILY_QUALIFIED'),
  constraint reward_events_daily_amount_check check (amount = 1),
  constraint reward_events_daily_plan_owner_fk foreign key (source_id, user_id)
    references public.daily_plans (id, user_id) on delete cascade,
  constraint reward_events_status_check check (
    (status = 'active' and reversed_at is null)
    or (status = 'reversed' and reversed_at is not null)
  )
);

alter table public.reward_events enable row level security;
revoke all on table public.reward_events from public, anon, authenticated;
grant select on table public.reward_events to authenticated;
create policy reward_events_select_own on public.reward_events
  for select to authenticated using ((select auth.uid()) = user_id);

-- Internal reconciliation of ONE locked, owned plan. Also used for migration
-- backfill, which must read persisted qualification rather than recompute Items.
create function public.sync_daily_reward_event(p_plan_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.daily_plans%rowtype;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'DAILY_PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;
  select plans.* into v_plan from public.daily_plans as plans
  where plans.id = p_plan_id and plans.user_id = p_user_id
  for update;
  if not found then return; end if;

  if v_plan.status = 'committed' and v_plan.is_qualified then
    insert into public.reward_events (user_id, source_type, source_id, amount)
    values (v_plan.user_id, 'DAILY_QUALIFIED', v_plan.id, 1)
    on conflict on constraint reward_events_source_key do update
      set status = 'active', reversed_at = null
      where reward_events.status = 'reversed';
    -- id / amount / created_at always belong to the original event.
  else
    update public.reward_events as events
    set status = 'reversed', reversed_at = clock_timestamp()
    where events.user_id = v_plan.user_id and events.source_type = 'DAILY_QUALIFIED'
      and events.source_id = v_plan.id and events.status = 'active';
    -- Never create a reversed event for a plan that has never earned a reward.
  end if;
end;
$$;
revoke all on function public.sync_daily_reward_event(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.refresh_daily_reward_from_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_qualified then
      perform public.sync_daily_reward_event(new.id, new.user_id);
    end if;
  elsif old.is_qualified is distinct from new.is_qualified then
    perform public.sync_daily_reward_event(new.id, new.user_id);
  end if;
  return null;
end;
$$;
revoke all on function public.refresh_daily_reward_from_plan()
  from public, anon, authenticated, service_role;

-- Extends M2-02's qualification UPDATE in the SAME RPC transaction. Any ledger
-- error aborts qualification, Item and Task writes; errors are never swallowed.
-- M2-02's threshold, counters, snapshots and existing RPC contracts stay intact.
create trigger daily_plan_reward_refresh
  after insert or update of is_qualified on public.daily_plans
  for each row execute function public.refresh_daily_reward_from_plan();

-- Existing qualified days did not previously have Reward Events. Record their
-- first observed reward now, NOT at plan_date / snapshot time / qualified_at.
-- Repeating this reconciliation is a no-op for an already-active source.
do $$
declare v_plan record;
begin
  for v_plan in select id, user_id from public.daily_plans
    where status = 'committed' and is_qualified order by id
  loop
    perform public.sync_daily_reward_event(v_plan.id, v_plan.user_id);
  end loop;
end;
$$;

COMMIT;

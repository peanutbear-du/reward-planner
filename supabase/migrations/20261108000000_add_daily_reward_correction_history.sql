-- RP-M3-07: retain Daily status changes even when terminal progress is protected.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create table public.reward_event_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_event_id uuid not null,
  status text not null check (status in ('reversed', 'active')),
  created_at timestamptz not null,
  foreign key (reward_event_id, user_id) references public.reward_events(id, user_id) on delete no action
);

create index reward_event_corrections_recent_idx
  on public.reward_event_corrections (user_id, created_at desc, id desc);

alter table public.reward_event_corrections enable row level security;
revoke all on public.reward_event_corrections from public, anon, authenticated, service_role;
grant select on public.reward_event_corrections to authenticated, service_role;
create policy reward_event_corrections_select_own on public.reward_event_corrections
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.record_daily_reward_correction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reward_event_corrections (user_id, reward_event_id, status, created_at)
  values (new.user_id, new.id, new.status, coalesce(new.reversed_at, clock_timestamp()));
  return null;
end;
$$;
revoke all on function public.record_daily_reward_correction()
  from public, anon, authenticated, service_role;

-- The Daily command already serializes this Event. The audit write is in
-- the same transaction and never changes the Event or allocation amounts.
create trigger daily_reward_correction_history
  after update of status on public.reward_events
  for each row
  when (old.status is distinct from new.status and new.source_type = 'DAILY_QUALIFIED')
  execute function public.record_daily_reward_correction();

commit;

-- RP-M3-01: persistence only. No allocation, unlock or reversal engine.
BEGIN;

create table public.wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  cover_path text,
  target integer not null,
  status text not null default 'wishlist',
  started_at timestamptz,
  unlocked_at timestamptz,
  redeemed_at timestamptz,
  reference_price numeric,
  why text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint wishes_id_user_id_key unique (id, user_id),
  constraint wishes_title_check check (title ~ '[^[:space:]]'),
  constraint wishes_target_check check (target > 0),
  constraint wishes_status_check check (status in ('wishlist', 'unlocking', 'unlocked', 'redeemed'))
);

-- Also serializes concurrent attempts to select different current Wishes.
-- Wishlist may retain started_at and allocations when a later Command switches.
create unique index wishes_one_unlocking_per_user_key
  on public.wishes (user_id) where status = 'unlocking';
create index wishes_user_id_status_idx on public.wishes (user_id, status);

-- Reuse the deployed Daily-only ledger, without changing any row or trigger.
alter table public.reward_events
  add constraint reward_events_id_user_id_key unique (id, user_id);

create table public.reward_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reward_event_id uuid not null,
  wish_id uuid,
  amount integer not null,
  allocation_type text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint reward_allocations_reward_owner_fk foreign key (reward_event_id, user_id)
    references public.reward_events (id, user_id) on delete no action,
  constraint reward_allocations_wish_owner_fk foreign key (wish_id, user_id)
    references public.wishes (id, user_id) on delete no action,
  -- Confirmed representation: positive allocations / negative corrections.
  -- No source/target uniqueness: one Event can split, move from Pending later,
  -- or acquire corrections without overwriting its original +N source amount.
  constraint reward_allocations_amount_check check (amount <> 0),
  constraint reward_allocations_target_check check (
    (allocation_type = 'wish' and wish_id is not null)
    or (allocation_type = 'pending' and wish_id is null)
  )
);

create index reward_allocations_reward_event_id_user_id_idx
  on public.reward_allocations (reward_event_id, user_id);
create index reward_allocations_user_id_wish_id_idx
  on public.reward_allocations (user_id, wish_id);

-- NO ACTION protects source/target history from standalone deletion. Deleting
-- an owning profile still cascades all its Wishes/Events/Allocations together.
alter table public.wishes enable row level security;
alter table public.reward_allocations enable row level security;
revoke all on table public.wishes, public.reward_allocations from public, anon, authenticated;
grant select on table public.wishes, public.reward_allocations to authenticated;

create policy wishes_select_own on public.wishes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy reward_allocations_select_own on public.reward_allocations
  for select to authenticated using ((select auth.uid()) = user_id);

COMMIT;

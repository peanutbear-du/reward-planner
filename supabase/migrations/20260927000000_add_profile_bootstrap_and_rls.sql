create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id)
select users.id
from auth.users as users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.tasks enable row level security;
alter table public.planning_items enable row level security;
alter table public.daily_plans enable row level security;
alter table public.daily_plan_items enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.user_settings from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.planning_items from anon, authenticated;
revoke all on table public.daily_plans from anon, authenticated;
revoke all on table public.daily_plan_items from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

grant select on table public.user_settings to authenticated;
grant insert (
  user_id,
  timezone,
  reminder_time,
  week_start,
  theme_accent,
  locale
) on table public.user_settings to authenticated;
grant update (
  timezone,
  reminder_time,
  week_start,
  theme_accent,
  locale
) on table public.user_settings to authenticated;

grant select on table public.tasks to authenticated;
grant select on table public.planning_items to authenticated;
grant select on table public.daily_plans to authenticated;
grant select on table public.daily_plan_items to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
  on public.user_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
  on public.user_settings
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
  on public.user_settings
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own
  on public.tasks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists planning_items_select_own on public.planning_items;
create policy planning_items_select_own
  on public.planning_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists daily_plans_select_own on public.daily_plans;
create policy daily_plans_select_own
  on public.daily_plans
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists daily_plan_items_select_own on public.daily_plan_items;
create policy daily_plan_items_select_own
  on public.daily_plan_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

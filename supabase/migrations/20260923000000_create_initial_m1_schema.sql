create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  timezone text not null default 'UTC',
  reminder_time time not null default '10:30',
  week_start smallint not null default 1,
  theme_accent text,
  locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_week_start_check check (week_start between 1 and 7)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  status text not null default 'open',
  project_id uuid,
  milestone_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_id_user_id_key unique (id, user_id),
  constraint tasks_title_check check (btrim(title) <> ''),
  constraint tasks_status_check check (status in ('open', 'completed')),
  constraint tasks_completion_state_check check (
    (status = 'open' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

create index tasks_user_id_status_idx
  on public.tasks (user_id, status);

create table public.planning_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid,
  milestone_id uuid,
  target_week date,
  planned_date date,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_items_task_owner_fk
    foreign key (task_id, user_id)
    references public.tasks (id, user_id)
    on delete cascade,
  constraint planning_items_target_check check (
    num_nonnulls(task_id, milestone_id) = 1
  ),
  constraint planning_items_end_requires_start_check check (
    end_time is null or start_time is not null
  ),
  constraint planning_items_time_order_check check (
    start_time is null or end_time is null or end_time > start_time
  )
);

create unique index planning_items_task_id_key
  on public.planning_items (task_id)
  where task_id is not null;

create unique index planning_items_milestone_id_key
  on public.planning_items (milestone_id)
  where milestone_id is not null;

create index planning_items_user_id_planned_date_idx
  on public.planning_items (user_id, planned_date)
  where planned_date is not null;

create index planning_items_user_id_target_week_idx
  on public.planning_items (user_id, target_week)
  where target_week is not null;

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_date date not null,
  status text not null default 'draft',
  snapshot_created_at timestamptz,
  is_qualified boolean not null default false,
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plans_id_user_id_key unique (id, user_id),
  constraint daily_plans_user_id_plan_date_key unique (user_id, plan_date),
  constraint daily_plans_status_check check (status in ('draft', 'committed')),
  constraint daily_plans_committed_snapshot_check check (
    status = 'draft' or snapshot_created_at is not null
  )
);

create table public.daily_plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  daily_plan_id uuid not null,
  task_id uuid,
  milestone_id uuid,
  origin text not null default 'initial',
  priority text not null default 'plan',
  result_status text not null default 'pending',
  added_at timestamptz not null default now(),
  completed_at_on_day timestamptz,
  rescheduled_to_date date,
  title_snapshot text not null,
  planned_start_time_snapshot time,
  planned_end_time_snapshot time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plan_items_daily_plan_owner_fk
    foreign key (daily_plan_id, user_id)
    references public.daily_plans (id, user_id)
    on delete cascade,
  constraint daily_plan_items_task_owner_fk
    foreign key (task_id, user_id)
    references public.tasks (id, user_id),
  constraint daily_plan_items_target_check check (
    num_nonnulls(task_id, milestone_id) = 1
  ),
  constraint daily_plan_items_origin_check check (
    origin in ('initial', 'added_later')
  ),
  constraint daily_plan_items_priority_check check (
    priority in ('must_do', 'plan')
  ),
  constraint daily_plan_items_result_status_check check (
    result_status in (
      'pending',
      'completed',
      'rescheduled',
      'cancelled',
      'incomplete'
    )
  ),
  constraint daily_plan_items_title_snapshot_check check (
    btrim(title_snapshot) <> ''
  ),
  constraint daily_plan_items_snapshot_end_requires_start_check check (
    planned_end_time_snapshot is null
    or planned_start_time_snapshot is not null
  ),
  constraint daily_plan_items_snapshot_time_order_check check (
    planned_start_time_snapshot is null
    or planned_end_time_snapshot is null
    or planned_end_time_snapshot > planned_start_time_snapshot
  )
);

create unique index daily_plan_items_task_id_key
  on public.daily_plan_items (daily_plan_id, task_id)
  where task_id is not null;

create unique index daily_plan_items_milestone_id_key
  on public.daily_plan_items (daily_plan_id, milestone_id)
  where milestone_id is not null;

create index daily_plan_items_daily_plan_id_idx
  on public.daily_plan_items (daily_plan_id);

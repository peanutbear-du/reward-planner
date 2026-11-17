-- RP-M4-01: owned Project and Milestone rows and links to existing Tasks.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  status text not null default 'active',
  scale text not null,
  reward_pool integer not null,
  deadline date,
  next_action_task_id uuid,
  scale_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint projects_id_user_id_key unique (id, user_id),
  constraint projects_title_check check (title ~ '[^[:space:]]'),
  constraint projects_status_check check (status in ('active', 'paused', 'completed')),
  constraint projects_scale_check check (scale in ('small', 'medium', 'large', 'major')),
  constraint projects_reward_pool_check check (reward_pool > 0),
  constraint projects_completion_state_check check (
    (status = 'completed') = (completed_at is not null)
  ),
  constraint projects_next_action_task_owner_fk
    foreign key (next_action_task_id, user_id) references public.tasks (id, user_id)
    on delete set null (next_action_task_id)
);

create index projects_user_id_status_idx on public.projects (user_id, status);
create index projects_next_action_task_idx
  on public.projects (next_action_task_id, user_id) where next_action_task_id is not null;

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null,
  title text not null,
  status text not null default 'pending',
  due_date date,
  reward_value integer not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint milestones_id_user_id_key unique (id, user_id),
  constraint milestones_id_user_id_project_id_key unique (id, user_id, project_id),
  constraint milestones_project_owner_fk
    foreign key (project_id, user_id) references public.projects (id, user_id),
  constraint milestones_title_check check (title ~ '[^[:space:]]'),
  constraint milestones_status_check check (status in ('pending', 'completed')),
  constraint milestones_reward_value_check check (reward_value >= 0),
  constraint milestones_completion_state_check check (
    (status = 'completed') = (completed_at is not null)
  )
);

create index milestones_user_id_project_id_idx on public.milestones (user_id, project_id);

-- A Task may have either link or both. When both are present, the Milestone
-- must belong to that Project. The separate owner FK also covers milestone-only Tasks.
alter table public.tasks
  add constraint tasks_project_owner_fk
    foreign key (project_id, user_id) references public.projects (id, user_id),
  add constraint tasks_milestone_owner_fk
    foreign key (milestone_id, user_id) references public.milestones (id, user_id),
  add constraint tasks_milestone_project_fk
    foreign key (milestone_id, user_id, project_id) references public.milestones (id, user_id, project_id);

create index tasks_project_owner_idx
  on public.tasks (project_id, user_id) where project_id is not null;
create index tasks_milestone_owner_project_idx
  on public.tasks (milestone_id, user_id, project_id) where milestone_id is not null;

-- Evaluate the rule on insertion so a future rule change leaves stored pools intact.
create function public.snapshot_project_reward_pool() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.reward_pool := case new.scale
    when 'small' then 4
    when 'medium' then 8
    when 'large' then 16
    when 'major' then 24
    else 0 -- Rejected by the scale and reward pool constraints.
  end;
  return new;
end;
$$;

create trigger projects_snapshot_reward_pool
  before insert on public.projects
  for each row execute function public.snapshot_project_reward_pool();

revoke all on function public.snapshot_project_reward_pool()
  from public, anon, authenticated, service_role;

alter table public.projects enable row level security;
alter table public.milestones enable row level security;
revoke all on table public.projects, public.milestones from public, anon, authenticated, service_role;
grant select on table public.projects, public.milestones to authenticated, service_role;

create policy projects_select_own on public.projects for select to authenticated
  using ((select auth.uid()) = user_id);
create policy milestones_select_own on public.milestones for select to authenticated
  using ((select auth.uid()) = user_id);

commit;

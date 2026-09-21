# Reward Planner — TECH_SPEC.md

> Version: v0.1  
> Status: MVP technical architecture  
> Principle: business rules live on the server; clients render server-authoritative state.

---

## 1. Architecture Overview

Clients:

- Desktop Main App
- Desktop Widget
- Mobile App

Backend:

- Next.js API/server

Data platform:

- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage

Core flow:

**Client → Business API → PostgreSQL**

Clients must not independently calculate core business truth.

Examples of server-authoritative logic:

- Daily Qualified
- reward grant/reversal
- Milestone reward
- Wish allocation
- Wish unlock
- overflow
- Pending Progress

---

## 2. Repository Structure

Target monorepo:

```text
reward-planner/
├── apps/
│   ├── desktop/              # React + Vite UI, browser-runnable from day 1
│   ├── api/                  # Next.js API / backend
│   └── mobile/               # React Native + Expo, created later
│
├── packages/
│   ├── api-client/
│   ├── types/
│   ├── schemas/
│   ├── business-constants/
│   └── utils/
│
├── supabase/
│   └── migrations/
│
├── PRD.md
├── TECH_SPEC.md
├── DESIGN_SPEC.md
├── BACKLOG.md
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
└── .env.example
```

Important:

- There is no separate `apps/web`.
- `apps/desktop` is a React + Vite frontend that runs in the browser during early development.
- The same desktop UI is later wrapped/activated as a Tauri app.
- `apps/api` is the server.
- `apps/mobile` is added later.

Package manager:

**pnpm workspaces**

Avoid Turborepo until there is a clear need.

---

## 3. Stack

### Desktop UI

- TypeScript
- React
- Vite
- Tauri later

### Backend

- Next.js
- TypeScript

### Database/Auth/Storage

- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage

### Mobile

- React Native
- Expo

### Client data

- TanStack Query

### Forms / validation

- React Hook Form
- Zod

### Week calendar

- FullCalendar on desktop

FullCalendar is an interaction/rendering tool, not the business model.

---

## 4. Platform Strategy

Development order:

1. browser-runnable desktop UI
2. backend + database
3. Tauri desktop wrapper
4. Desktop Widget
5. React Native mobile app

No public web product is required for MVP.

Browser mode exists primarily for fast development/testing.

---

## 5. Shared vs Platform-specific

Shared:

- backend
- DB
- business rules
- API client
- types
- schemas
- business constants
- partial design tokens

Not necessarily shared:

- React DOM UI components
- React Native UI components
- desktop navigation
- mobile navigation
- desktop-specific widget behavior

Do not force UI code reuse between React DOM and React Native.

---

## 6. Data Model

### 6.1 profiles

Fields:

- id
- display_name
- created_at
- updated_at

### 6.2 user_settings

Fields:

- user_id
- timezone
- reminder_time
- week_start
- theme_accent
- locale

Cloud settings:

- timezone
- reminder
- week start
- accent
- locale

Device-local settings:

- widget enabled
- widget position
- pinned state
- local device preferences

### 6.3 projects

Fields:

- id
- user_id
- title
- status: active | paused | completed
- scale: small | medium | large | major
- reward_pool
- deadline nullable
- next_action_task_id nullable
- scale_locked boolean
- created_at
- updated_at
- completed_at nullable

`reward_pool` should be snapshotted from Scale at creation to protect historical rule changes.

### 6.4 milestones

Fields:

- id
- user_id
- project_id
- title
- status: pending | completed
- due_date nullable
- reward_value
- completed_at nullable
- created_at
- updated_at

### 6.5 tasks

Fields:

- id
- user_id
- title
- status
- project_id nullable
- milestone_id nullable
- completed_at nullable
- created_at
- updated_at

Task is one global object.

Do not duplicate a Task for Today / Week / Project views.

### 6.6 planning_items

Purpose:

schedule one Task or Milestone.

Fields:

- id
- user_id
- task_id nullable
- milestone_id nullable
- target_week nullable
- planned_date nullable
- start_time nullable
- end_time nullable
- priority nullable
- created_at
- updated_at

Constraint:

Exactly one of:

- task_id
- milestone_id

must be set.

Flow:

weekly pool → date → optional time.

### 6.7 calendar_events

Fields:

- id
- user_id
- title
- event_date
- start_time
- end_time
- notes nullable
- created_at
- updated_at

Calendar Events do not participate in Daily completion.

### 6.8 week_notes

Fields:

- id
- user_id
- week_start_date
- content
- created_at
- updated_at

### 6.9 important_dates

Fields:

- id
- user_id
- title
- date
- notes nullable
- created_at
- updated_at

Standalone Month-level event.

### 6.10 daily_plans

Fields:

- id
- user_id
- plan_date
- status
- snapshot_created_at
- is_qualified
- qualified_at nullable
- created_at
- updated_at

Constraint:

unique `(user_id, plan_date)`

### 6.11 daily_plan_items

Fields:

- id
- user_id
- daily_plan_id
- task_id nullable
- milestone_id nullable
- origin: initial | added_later
- priority: must_do | plan
- result_status:
  - pending
  - completed
  - rescheduled
  - cancelled
  - incomplete
- added_at
- completed_at_on_day nullable
- rescheduled_to_date nullable
- title_snapshot
- created_at
- updated_at

This table is the per-day historical truth.

Global Task state must not overwrite past Daily history.

### 6.12 wishes

Fields:

- id
- user_id
- title
- cover_path nullable
- target
- status: wishlist | unlocking | unlocked | redeemed
- started_at nullable
- unlocked_at nullable
- redeemed_at nullable
- reference_price nullable
- why nullable
- created_at
- updated_at

Constraint:

At most one Unlocking Wish per user.

### 6.13 reward_events

Fields:

- id
- user_id
- source_type:
  - DAILY_QUALIFIED
  - MILESTONE_COMPLETED
- source_id
- amount
- status: active | reversed
- created_at
- reversed_at nullable

Constraint:

Unique source identity prevents duplicate reward.

### 6.14 reward_allocations

Fields:

- id
- user_id
- reward_event_id
- wish_id nullable
- amount
- allocation_type: wish | pending
- created_at

One Reward Event may split across multiple allocations.

Example:

+8 event:

- +2 Wish A
- +6 Pending

### 6.15 completion_tickets

Fields:

- id
- user_id
- wish_id
- snapshot_json
- created_at

Ticket is immutable after creation.

---

## 7. Core Domain Commands

Core product transitions should use semantic commands rather than direct table writes from clients.

### Daily

- `commitDailyPlan(date)`
- `addItemToToday(...)`
- `completeTask(taskId, context)`
- `uncompleteTask(taskId, context)`
- `rescheduleTask(...)`
- `cancelDailyItem(...)`

### Project

- `createProject(...)`
- `completeMilestone(milestoneId)`
- `reverseMilestone(milestoneId)`
- `setNextAction(projectId, taskId)`
- `completeProject(projectId)`
- `pauseProject(projectId)`

### Wish

- `createWish(...)`
- `startWish(wishId)`
- `switchWish(wishId)`
- `redeemWish(wishId)`

Wish unlock should be internal automatic logic, not an arbitrary client command.

---

## 8. Daily Business Logic

### 8.1 commitDailyPlan

Requirements:

- idempotent
- require at least one eligible item
- create Daily Plan
- snapshot current initial items
- store title snapshots

### 8.2 addItemToToday

If Today is not committed:

- edit Draft

If Today is committed:

- create Daily Plan Item with `origin=added_later`
- recalculate Daily status

### 8.3 completeTask

Transaction:

1. update global Task status
2. if related to current Daily Plan:
   - update Daily Plan Item result
3. update Project activity
4. recalculate Daily qualification
5. process reward transition if needed

### 8.4 Daily qualification transition

Only transitions matter:

- false → true = grant +1
- true → false = reverse +1
- true → true = no additional reward
- false → false = no reward action

### 8.5 reschedule

If item is in historical/current Daily Plan:

- old Daily Plan Item becomes Rescheduled
- old day stays incomplete
- planning relation moves to new date
- future Daily relation is created only according to future Daily Plan semantics

Do not fabricate future history in advance.

---

## 9. Milestone Business Logic

Complete Milestone transaction:

1. verify incomplete
2. mark complete
3. create/activate unique Milestone Reward Event
4. allocate reward
5. update Project activity
6. return Effects

Reverse Milestone:

1. confirm user intent
2. mark incomplete
3. reverse Reward Event
4. reverse active allocations where allowed
5. preserve already-unlocked Wish irreversibility

Milestone completion must be idempotent.

---

## 10. Reward Allocation Logic

### 10.1 Current Wish exists

Apply reward to Unlocking Wish.

If reward exceeds remaining target:

- apply needed amount
- unlock Wish
- move overflow to Pending

### 10.2 No current Wish

All reward becomes Pending.

### 10.3 Start/resume Wish

Recommended MVP rule:

`startWish` automatically applies Pending Progress.

If Pending is enough to unlock the Wish:

- unlock it transactionally
- leave remaining overflow as Pending

No separate wallet UI.

---

## 11. Transactions and Atomicity

Architecture:

- Next.js API owns command orchestration.
- PostgreSQL/Supabase handles persistence.
- transaction-critical multi-table transitions should be atomic.

Recommended pattern:

- TypeScript command boundary in API
- narrowly scoped PostgreSQL function/RPC for operations requiring true DB transaction guarantees
- constraints + idempotency at DB level

Examples requiring atomicity:

- Daily qualification reward transition
- Milestone completion + reward
- reward allocation + overflow
- start Wish + apply Pending
- redeem Wish + Completion Ticket snapshot

Do not let the frontend perform these transitions in multiple independent writes.

---

## 12. Supabase Security

All user-owned rows must include `user_id`.

Use RLS for routine authenticated access.

Important:

- service-role key bypasses RLS
- never package service-role secret into desktop/mobile clients
- never claim RLS protects service-role operations

Preferred:

- routine reads/writes with authenticated user session where appropriate
- server-only scoped privileged operations when required

---

## 13. Auth

MVP:

- email
- password

Skip:

- phone
- social login
- magic link unless later needed

Session persistence:

Desktop:

- secure OS/app storage when Tauri is enabled

Mobile:

- Expo SecureStore

---

## 14. Storage

MVP file storage:

Wish cover image only.

Path example:

`wish-covers/{user_id}/{wish_id}.jpg`

Client may compress/crop image before upload.

Target long edge:

approximately 1000–1500 px.

No PDFs, docs, avatars, or arbitrary user files in MVP.

---

## 15. Time and Timezone

Store timestamps in UTC.

Use user timezone to interpret:

- Today
- Daily qualification date
- 10:30 reminder
- Day Review
- Week grouping

Use:

- SQL DATE for date-semantic fields
- TIMESTAMPTZ for true timestamps

No midnight cron is required.

Historical Daily Plan records are persisted explicitly.

---

## 16. API Shape

Use:

- Query = read
- Command = meaningful action

### Query examples

- `GET /today`
- `GET /week`
- `GET /month`
- `GET /projects`
- `GET /projects/:id`
- `GET /wish-board`
- `GET /review/month`
- `GET /review/year`
- `GET /day-review/:date`

### Command examples

- `POST /commands/daily/commit`
- `POST /commands/daily/add-item`
- `POST /commands/task/complete`
- `POST /commands/task/uncomplete`
- `POST /commands/task/reschedule`
- `POST /commands/milestone/complete`
- `POST /commands/milestone/reverse`
- `POST /commands/wish/start`
- `POST /commands/wish/switch`
- `POST /commands/wish/redeem`

Exact paths may evolve.

Command responses should include:

```json
{
  "data": {},
  "effects": [
    "task_completed",
    "daily_qualified",
    "reward_granted",
    "wish_progress_changed"
  ]
}
```

Frontend should react to Effects instead of recalculating the domain transition.

---

## 17. Error Model

Domain errors should be explicit.

Examples:

- `DAILY_PLAN_ALREADY_COMMITTED`
- `DAILY_PLAN_EMPTY`
- `MILESTONE_ALREADY_COMPLETED`
- `WISH_ALREADY_UNLOCKING`
- `WISH_NOT_UNLOCKED`
- `PROJECT_SCALE_LOCKED`
- `UNAUTHORIZED_RESOURCE`

Do not return expected business errors as generic HTTP 500.

---

## 18. Frontend Architecture

Layers:

**Page → Feature → Shared Component → Data/API**

### Shared business-object components

Examples:

- TaskItem
- MilestoneItem
- ProjectCard
- Block
- BlockGrid
- DateNavigator
- ScheduleItem

Avoid duplicating Task UI separately for Today / Week / Project.

Use contextual variants.

### State

Use:

- TanStack Query for server state
- local React state for local UI state

Do not add Redux/Zustand unless a real need appears.

### Forms

Use:

- React Hook Form
- Zod

---

## 19. Today Frontend Direction

Today should support:

- Draft
- Committed / In Progress

Do not build two unrelated pages.

Use the same page structure with state-driven variants.

Desktop direction:

- compact sidebar
- compact header
- Tasks and Schedule side by side
- Project Focus below
- Daily status integrated into header/context

Avoid large KPI cards.

---

## 20. Week Frontend

FullCalendar may be used for desktop Week.

Calendar adapter must map:

- Task
- Milestone
- Calendar Event

into different visual semantics.

FullCalendar must not become the domain model.

Drag:

- modifies same planning relation
- never copies Task identity

---

## 21. Desktop / Tauri

`apps/desktop` starts as browser-runnable React + Vite.

Later Tauri adds:

- native shell
- tray
- multiple windows
- notifications
- always-on-top
- autostart
- secure local settings

Desktop Widget should be another window within the same Tauri application.

Do not create a second independent desktop application.

---

## 22. Mobile

Mobile later uses:

- React Native
- Expo

Likely bottom nav:

- Plan
- Projects
- Wish
- Review

Mobile Week should not blindly reproduce a 7-column desktop calendar.

Possible direction:

- selected day / 3-day view
- This Week drawer

Mobile is a separate layout system using shared API/domain types.

---

## 23. Sync

Primary truth:

Cloud database.

MVP sync:

1. client sends command
2. backend writes DB
3. command returns
4. clients refetch relevant queries

Do not build realtime first.

Supabase Realtime may be added later selectively.

---

## 24. Offline

MVP:

- allow cached reads
- when truly offline, block domain writes with clear feedback

Do not build:

- local full replica
- conflict resolution engine
- CRDT
- offline-first architecture

---

## 25. Environment

Separate:

- Development
- Production

Use:

- `.env.local` locally
- `.env.example` committed with variable names only

Never commit:

- service-role secret
- production secrets
- access tokens

Potential environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
API_BASE_URL=
```

Final names may differ.

---

## 26. Deployment

Likely MVP:

API:

- Vercel

Database/Auth/Storage:

- Supabase

Desktop:

- Tauri build/sign/release later

Mobile:

- Expo / native stores later

Avoid early:

- self-hosted PostgreSQL
- Redis
- Kafka
- microservices
- WebSockets
- full observability stack

---

## 27. Testing Strategy

Critical domain logic requires automated tests.

Must test:

### Daily

- 79% not qualified
- 80% qualified
- Must-do incomplete blocks qualification
- no Must-do works correctly
- reward is not duplicated
- reward reverses correctly

### Milestone

- completion idempotent
- reward once
- reversal correct

### Wish

- 58/60 +8 → 60/60 + 6 Pending
- no current Wish → Pending
- start Wish auto-applies Pending
- unlocked Wish does not relock after historical correction

### History

- rescheduled historical day remains unchanged

Prefer integration tests for transaction-sensitive rules.

---

## 28. Definition of Done

A ticket is done only when:

- acceptance criteria are met
- relevant tests pass
- typecheck passes
- lint passes
- schema changes use migrations
- no unrelated refactor is included
- no new console warnings/errors
- happy path manually checked
- changed files are reported
- commands/tests run are reported
- unresolved issues are explicitly listed

---

## 29. Technical Non-goals

Do not add without explicit approval:

- apps/web
- Prisma
- Drizzle
- Redis
- Kafka
- microservices
- GraphQL
- realtime-first architecture
- CRDT
- local-first DB
- Redux/Zustand by default
- heavy design system dependency
- arbitrary admin panel

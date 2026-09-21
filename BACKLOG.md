# Reward Planner — BACKLOG.md

> Version: v0.1  
> Rule: implement one ticket at a time.  
> Status legend: `TODO` / `IN PROGRESS` / `DONE`

---

# Stage Gates

## Gate A — Today usable

User can:

- sign in
- create Tasks
- create a Today plan
- commit Initial Snapshot
- complete / uncomplete Tasks
- see accurate Daily completion

## Gate B — Daily → Wish loop stable

User can:

- qualify a day
- receive +1
- create/start a Wish
- see Wish progress
- handle reward reversal
- handle overflow / Pending

## Gate C — Project → Milestone → Wish

User can:

- create Project
- create Milestones
- assign reward
- complete Milestone
- receive reward
- see Project activity

## Gate D — Week planning

User can:

- manage Weekly Pool
- assign date/time
- see Tasks and Calendar Events
- move items without duplication

## Gate E — History / Review

User can:

- view Month
- view Day Review
- view Month/Year Review
- preserve historical truth

## Gate F — Desktop / Widget

User can:

- run Tauri app
- use Widget
- receive reminder
- interact with Today from Widget

## Gate G — Mobile

Core workflows available in Expo app.

---

# M0 — Project Foundation

## RP-M0-01 — Initialize pnpm workspace

Status: TODO

Goal:

Create the monorepo foundation.

Requirements:

- root `package.json`
- `pnpm-workspace.yaml`
- TypeScript baseline
- workspace scripts
- no Turborepo

Acceptance Criteria:

- `pnpm install` succeeds
- root scripts can run package-level commands
- repository structure matches TECH_SPEC

Do Not:

- create `apps/web`
- add unrelated tooling

---

## RP-M0-02 — Create Desktop browser shell

Status: TODO

Goal:

Create `apps/desktop` as React + Vite + TypeScript.

Acceptance Criteria:

- app runs in browser
- minimal app shell renders
- no Tauri requirement yet
- design tokens can be added cleanly later

---

## RP-M0-03 — Create API service

Status: TODO

Goal:

Create `apps/api` as Next.js + TypeScript backend.

Acceptance Criteria:

- development server runs
- health endpoint works
- no business logic yet

---

## RP-M0-04 — Create shared packages

Status: TODO

Create:

- `packages/api-client`
- `packages/types`
- `packages/schemas`
- `packages/business-constants`
- `packages/utils`

Acceptance Criteria:

- desktop and API can import shared packages
- TypeScript path/build config works

---

## RP-M0-05 — Configure quality scripts

Status: TODO

Set up:

- typecheck
- lint
- test baseline

Acceptance Criteria:

- root `pnpm typecheck`
- root `pnpm lint`
- root `pnpm test`

all run successfully.

---

## RP-M0-06 — Create environment template

Status: TODO

Create `.env.example`.

Rules:

- variable names only
- no real secrets

---

# M1 — Task + Today

## RP-M1-01 — Create initial database migration

Status: TODO

Tables:

- profiles
- user_settings
- tasks
- planning_items
- daily_plans
- daily_plan_items

Acceptance Criteria:

- migration is repeatable
- user ownership fields exist
- basic constraints exist

---

## RP-M1-02 — Configure Supabase Auth

Status: TODO

MVP auth:

- email
- password

Acceptance Criteria:

- sign up
- sign in
- sign out
- session restore

---

## RP-M1-03 — Add RLS baseline

Status: TODO

Acceptance Criteria:

- users can only read/write their own rows
- tests/manual verification confirm ownership isolation

---

## RP-M1-04 — Today aggregate query

Status: TODO

Return:

- Daily Plan state
- Daily Plan Items
- schedule context
- compact active Project placeholder structure if Projects not yet implemented

Frontend must not calculate qualification.

---

## RP-M1-05 — Create Task

Status: TODO

Acceptance Criteria:

- create ordinary Task
- optionally schedule date/time
- no Task duplication between views

---

## RP-M1-06 — Edit Task safely

Status: TODO

Rules:

- ordinary unreferenced Draft Task may be editable
- do not hard-delete historical referenced Tasks
- preserve history

---

## RP-M1-07 — Commit Daily Plan

Status: TODO

Command:

`commitDailyPlan(date)`

Acceptance Criteria:

- requires at least one eligible item
- creates immutable Initial Snapshot
- idempotent
- stores per-day relations and title snapshots

---

## RP-M1-08 — Added Later

Status: TODO

Acceptance Criteria:

- add Task after snapshot
- creates `origin=added_later`
- shows separately where relevant
- enters Daily denominator

---

# M2 — Daily Qualification + History

## RP-M2-01 — Complete / uncomplete Task

Status: TODO

Acceptance Criteria:

- Task global status updates
- Daily Plan Item updates
- Daily status recalculates server-side

---

## RP-M2-02 — Daily qualification engine

Status: TODO

Rules:

- N > 0
- all Must-do complete
- >= 80%
- Calendar Event excluded

Acceptance tests:

- 79% → false
- 80% → true
- missing Must-do → false
- no Must-do + 80% → true

---

## RP-M2-03 — Daily Reward Event

Status: TODO

Acceptance Criteria:

- false → true grants +1
- true → false reverses +1
- repeat true state does not duplicate
- unique source invariant exists

---

## RP-M2-04 — Reschedule history

Status: TODO

Acceptance Criteria:

- original Daily item becomes Rescheduled
- original day stays incomplete
- future planning date changes
- future historical Daily Plan is not fabricated

Test:

Sep21 → Sep22 example.

---

## RP-M2-05 — Cancel Daily item

Status: TODO

Acceptance Criteria:

- cancelled item remains part of original Daily truth
- does not disappear from denominator/history silently

---

# M3 — Wish + Reward Allocation

## RP-M3-01 — Wish schema

Status: TODO

Tables:

- wishes
- reward_events if not already
- reward_allocations

Constraint:

- one Unlocking Wish per user

---

## RP-M3-02 — Create Wish

Status: TODO

Fields:

- name
- target
- optional cover
- optional reference price
- optional why

---

## RP-M3-03 — Wish cover upload

Status: TODO

Storage:

`wish-covers/{user}/{wish}.jpg`

Acceptance Criteria:

- authenticated ownership
- reasonable file validation
- no arbitrary file storage

---

## RP-M3-04 — Start / switch Wish

Status: TODO

Acceptance Criteria:

- one Unlocking
- previous progress preserved
- starting/resuming Wish auto-applies Pending Progress

---

## RP-M3-05 — Reward allocation engine

Status: TODO

Cases:

- active Wish
- no active Wish
- overflow
- Pending

Required test:

58/60 +8 → +2 Wish, +6 Pending.

---

## RP-M3-06 — Wish unlock

Status: TODO

Acceptance Criteria:

- automatic at target
- status becomes Unlocked
- future reward no longer flows into unlocked Wish
- unlocked Wish is irreversible

---

## RP-M3-07 — Reward reversal

Status: TODO

Acceptance Criteria:

- active Wish progress may decrease when valid
- already Unlocked/Redeemed Wish does not relock
- correction remains traceable

---

## RP-M3-08 — Wish Board UI

Status: TODO

Includes:

- Unlocking
- Wishlist
- Completed
- 60-cell grid
- recent reward entries

Follow DESIGN_SPEC.

---

# M4 — Projects + Milestones

## RP-M4-01 — Project and Milestone schema

Status: TODO

Acceptance Criteria:

- Project requires at least one Milestone by creation flow
- Scale maps to reward pool
- reward pool is snapshotted

---

## RP-M4-02 — Project creation

Status: TODO

Scale values:

- Small +4
- Medium +8
- Large +16
- Major +24

Default Milestone allocation:

- even distribution
- remainder to final Milestone

---

## RP-M4-03 — Project Overview UI

Status: TODO

Show:

- name
- scale
- next milestone
- next action
- deadline
- activity pulse

Do not show completion percentage.

---

## RP-M4-04 — Project Detail UI

Status: TODO

Includes:

- Next Milestone
- Next Action
- Milestones
- linked Tasks
- important dates
- reward pool summary
- activity pulse

---

## RP-M4-05 — Next Action

Status: TODO

Rule:

Next Action is an ordinary Task referenced by `next_action_task_id`.

Acceptance Criteria:

- add existing/new Task as Next Action
- Add to Today
- Add to Week

---

## RP-M4-06 — Complete Milestone

Status: TODO

Acceptance Criteria:

- idempotent
- Milestone reward once
- Wish progress updates
- Project activity updates

---

## RP-M4-07 — Reverse Milestone

Status: TODO

Acceptance Criteria:

- explicit confirmation
- reward reverses correctly
- Wish unlock irreversibility respected

---

## RP-M4-08 — Milestone redistribution

Status: TODO

Rules:

- after earned reward, earned amount fixed
- only remaining pool redistributes
- Scale locked after first Milestone completion

---

## RP-M4-09 — Project Activity Pulse

Status: TODO

Derived from recent activity.

Not completion percentage.

---

# M5 — Week

## RP-M5-01 — Week aggregate query

Status: TODO

Returns:

- dated Tasks
- timed Tasks
- Weekly Pool
- Calendar Events
- Milestone / Deadline context
- Week Note

---

## RP-M5-02 — FullCalendar adapter

Status: TODO

Map:

- Task
- Milestone
- Calendar Event

into distinct visual objects.

Do not use FullCalendar as the domain model.

---

## RP-M5-03 — Weekly Pool

Status: TODO

Acceptance Criteria:

- Task may exist in Weekly Pool without date
- drag/assign to date
- preserve Task identity

---

## RP-M5-04 — Date / time scheduling

Status: TODO

Flow:

Pool → Date → Optional Time.

---

## RP-M5-05 — Calendar Events

Status: TODO

Acceptance Criteria:

- time occupation
- non-completion
- visually distinct from timed Task

---

## RP-M5-06 — Week Note

Status: TODO

Pure text note separate from Tasks.

---

# M6 — Month + Review

## RP-M6-01 — Important Date schema/UI

Status: TODO

Month includes:

- Project Deadline
- Milestone Due
- Important Date
- Daily state

No ordinary schedule.

---

## RP-M6-02 — Day Review

Status: TODO

Read-only.

Show:

- Initial
- Added Later
- reschedule/cancel result
- Daily stats
- Project impact
- Wish reward

---

## RP-M6-03 — Month Review

Status: TODO

Suggested:

- Qualified Days
- Avg Completion
- Longest Qualified Streak
- Project Activity
- Wish reward contribution

---

## RP-M6-04 — Year Review

Status: TODO

52-week heatmap.

---

# M7 — Completion Ticket

## RP-M7-01 — Redeem Wish

Status: TODO

Only Unlocked Wish can be Redeemed.

---

## RP-M7-02 — Ticket snapshot generation

Status: TODO

Transaction:

redeem → immutable Completion Ticket snapshot.

---

## RP-M7-03 — Ticket page

Status: TODO

Include:

- dates
- days to unlock
- qualified days
- milestone count
- progress
- ~3 representative contributions

Default share hides detailed Todos.

---

# M8 — Tauri Desktop + Widget

## RP-M8-01 — Add Tauri wrapper

Status: TODO

Use existing `apps/desktop`.

Do not create a second UI implementation.

---

## RP-M8-02 — Secure session / device settings

Status: TODO

---

## RP-M8-03 — Widget windows

Status: TODO

States:

- Ambient
- Hover Peek
- Pinned

---

## RP-M8-04 — Widget Today interaction

Status: TODO

Pinned Widget:

- complete Todo
- add Todo
- open full Plan

---

## RP-M8-05 — 10:30 reminder

Status: TODO

If no Today Snapshot:

- local desktop reminder

---

## RP-M8-06 — Reward feedback

Status: TODO

Show:

- +1 Daily
- +N Milestone

Restrained animation.

---

# M9 — Mobile

## RP-M9-01 — Create Expo app

Status: TODO

---

## RP-M9-02 — Mobile auth

Status: TODO

---

## RP-M9-03 — Mobile navigation

Status: TODO

Likely:

- Plan
- Projects
- Wish
- Review

---

## RP-M9-04 — Mobile Today

Status: TODO

Vertical-first layout.

---

## RP-M9-05 — Mobile Projects / Wish / Review

Status: TODO

---

## RP-M9-06 — Mobile Week / Month

Status: TODO

Do not simply shrink desktop 7-column Week.

---

## RP-M9-07 — Mobile notifications

Status: TODO

Avoid duplicate desktop/mobile reminder behavior.

---

# M10 — Hardening / Release

## RP-M10-01 — Loading / error / empty states

Status: TODO

## RP-M10-02 — Analytics events

Status: TODO

## RP-M10-03 — RLS / domain integration tests

Status: TODO

## RP-M10-04 — Production deployment

Status: TODO

## RP-M10-05 — Desktop signing/release

Status: TODO

---

# Working Rule

Codex should never receive:

> "Build Reward Planner."

Instead:

> "Implement RP-MX-YY according to BACKLOG.md, PRD.md, TECH_SPEC.md, DESIGN_SPEC.md, and AGENTS.md."

One ticket at a time.

# Reward Planner — AGENTS.md

This file defines mandatory rules for AI coding agents working in this repository.

Read before making any change:

- `PRD.md`
- `TECH_SPEC.md`
- `DESIGN_SPEC.md`
- `BACKLOG.md`
- this file

---

## 1. Scope Discipline

Implement only the current ticket.

Do not:

- add unrelated features
- perform unrelated refactors
- add dependencies without a concrete need
- redesign product rules
- "improve" UX by inventing new behavior

If a requirement is ambiguous and changes product semantics:

- stop
- state the ambiguity
- ask for a decision

If ambiguity is implementation-only and does not change product behavior:

- choose the smallest compliant solution

---

## 2. Product Rules Are Not Optional

Do not silently change:

- Daily qualification rules
- reward rules
- Wish rules
- Project scale rules
- history semantics
- object identity

The PRD is authoritative for product behavior.

---

## 3. Task Identity

A Task is one object across:

- Today
- Week
- Project

Do not duplicate Tasks when changing views or schedule.

Views reference the same Task.

---

## 4. Daily Plan Truth

Daily Plan Snapshot preserves historical truth.

After a day is committed:

- initial items are snapshotted
- Added Later items are recorded separately
- reschedule/cancel remains visible in original-day history

Do not rewrite historical Daily truth based on later Task state.

---

## 5. Daily Qualification

Frontend must never be the source of truth for qualification.

Server decides:

- denominator
- Must-do status
- >=80% rule
- qualification transition

Only transition:

- false → true grants Daily +1
- true → false reverses Daily +1

Never duplicate Daily reward.

---

## 6. Reward Rules

Only two reward sources exist:

- Daily Qualified = +1
- Milestone Completed = +N

Do not add:

- XP
- coins
- levels
- streak reward
- ordinary Task reward
- calendar reward
- "bonus" reward

Reward must be event-sourced and traceable.

---

## 7. Wish Rules

Only one Wish can be Unlocking.

Pending Progress is:

- temporary unallocated progress
- not a wallet
- not currency

Starting/resuming a Wish should auto-apply Pending Progress according to TECH_SPEC.

Wish unlock is automatic at target.

Unlocked/Redeemed Wish must not relock because of later historical reward correction.

---

## 8. Project Rules

Project scale:

- Small +4
- Medium +8
- Large +16
- Major +24

Scale means effort/size, not importance.

Normal Tasks grant no Project reward.

Milestones grant reward.

Project completion percentage must not be invented.

Activity Pulse is not completion percentage.

---

## 9. Server Authority

Clients send actions.

Server determines consequences.

Do not let frontend directly write:

- `is_qualified`
- reward amount
- Wish progress
- Wish unlock
- Milestone reward
- historical Daily result truth

Use domain Commands for multi-step transitions.

---

## 10. Transactions

Multi-table domain transitions must be atomic when partial failure would violate product truth.

Examples:

- Daily qualification + reward
- Milestone completion + reward
- reward allocation + Wish unlock
- Pending → Wish allocation
- Redeem + Completion Ticket

Use narrow DB transaction/RPC boundaries where necessary.

Do not fake transactionality in the client.

---

## 11. Database Changes

Every schema change must use a migration.

Do not modify production schema manually without migration.

Add constraints for critical invariants where possible.

Examples:

- unique Daily Plan per user/date
- unique Reward source
- one Unlocking Wish per user
- one planning item target type

---

## 12. Security

Never commit secrets.

Never expose:

- Supabase service-role key
- private API tokens
- production credentials

Never package service-role credentials in:

- React desktop bundle
- Tauri frontend
- React Native app

Remember:

service-role bypasses RLS.

Do not claim RLS protects service-role operations.

---

## 13. User Ownership

Every user-owned data row must be scoped by user.

Use RLS / authorization checks according to TECH_SPEC.

Never trust resource IDs from the client without ownership validation.

---

## 14. Architecture Rules

Repository structure:

- `apps/desktop` = React + Vite
- `apps/api` = Next.js backend
- `apps/mobile` = Expo later

Do not create:

- `apps/web`

Do not introduce:

- Prisma
- Drizzle
- Redis
- Kafka
- microservices
- GraphQL
- Redux/Zustand

unless explicitly approved.

Use pnpm workspaces.

---

## 15. Frontend State

Preferred:

- TanStack Query for server state
- React state for local UI state
- React Hook Form + Zod for forms

Do not add a global state library preemptively.

---

## 16. Design Rules

Follow `DESIGN_SPEC.md`.

Do not invent a new visual language.

Do not add "polish" through:

- large shadows
- gradients
- glassmorphism
- excessive Card containers
- random Project colors
- game-like effects

Visual direction:

**Compact + Flat + Modular**

Use intentional whitespace, but avoid excessive empty Dashboard-style zones.

---

## 17. Locale Rules

Never mix Chinese and English UI copy on the same locale screen.

Examples:

Correct:

- zh-CN screen: Chinese UI copy
- en-US screen: English UI copy

Incorrect:

- "必须完成 / Must-do"
- "日程 / Schedule"

Proper nouns and user-created content may remain in original language.

---

## 18. Block Semantics

Block is a meaningful visualization for:

- progress
- activity
- rhythm
- reward feedback

Do not use Blocks as meaningless decoration.

Wish Grid, Heatmap, Activity Pulse, and Daily completion may share Block language but have different semantics.

Do not conflate them.

---

## 19. Component Reuse

Reuse obvious business-object components.

Examples:

- TaskItem
- MilestoneItem
- ProjectCard
- Block
- BlockGrid
- ScheduleItem

Do not prematurely abstract tiny one-off fragments.

Do not duplicate separate Task implementations for Today/Week/Project.

---

## 20. Testing

For every critical domain ticket:

- add or update relevant tests
- run them before finishing

Critical examples:

- 79% / 80%
- Must-do qualification
- no duplicate Daily reward
- Milestone idempotency
- 58/60 +8 overflow
- reschedule historical truth
- unlocked Wish irreversibility

---

## 21. Definition of Done

Before marking a ticket complete:

- acceptance criteria met
- relevant tests pass
- typecheck passes
- lint passes
- migrations included if needed
- no unrelated files changed
- no unnecessary dependency added
- no new warning/error
- happy path manually verified when applicable

Final report must include:

1. changed files
2. summary of implementation
3. commands/tests run
4. manual verification performed
5. unresolved issues / follow-ups

---

## 22. Working with BACKLOG

Implement one ticket at a time.

Do not automatically proceed to the next ticket.

After completing a ticket:

- report completion
- wait for review / instruction

Do not mark a backlog item DONE unless its acceptance criteria have actually been verified.

---

## 23. Current Priority

Until explicitly changed, development follows:

M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9

Core proof loop:

**Today → Daily Qualified → Wish → Project/Milestone → Week**

Do not jump ahead to Mobile or advanced polish before the core loop is stable.

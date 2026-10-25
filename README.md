# Reward Planner

Reward Planner is a personal planning tool that connects long-term goals to daily execution, truthful review, and meaningful reward.

Core loop:

**Project → Plan → Execution → Review → Wish**

## Project docs

Read in this order:

1. `PRD.md` — product behavior and rules
2. `TECH_SPEC.md` — technical architecture
3. `DESIGN_SPEC.md` — visual and interaction rules
4. `BACKLOG.md` — development milestones and tickets
5. `AGENTS.md` — mandatory instructions for coding agents

## Planned architecture

- `apps/desktop` — React + Vite, later wrapped with Tauri
- `apps/api` — Next.js API/server
- `apps/mobile` — React Native + Expo, later
- Supabase — PostgreSQL/Auth/Storage
- pnpm workspaces

## Current phase

Documentation and UI design.

Do not begin broad implementation before the current M0 ticket is explicitly selected.

## Today desktop development (RP-UI-01)

Configure the existing root `.env.local` for Supabase Auth and `apps/api/.env.local`
for the Business API. Keep all server secrets and test credentials outside `VITE_*`
variables. Run these in separate terminals:

```sh
pnpm --filter @reward-planner/api dev
pnpm --filter @reward-planner/desktop dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `127.0.0.1:3001`, including
the session Bearer Token. No production CORS policy is changed. Leave
`VITE_API_BASE_URL` empty for this development path; a deployed desktop can set it
to its Business API origin, whose deployment must support the intended client.

Frontend checks from the repository root:

```sh
pnpm exec vitest run --config apps/desktop/vitest.config.ts
pnpm typecheck
pnpm lint
pnpm --filter @reward-planner/desktop build
```

The Today screen uses browser-local calendar dates. Create-and-add uses two existing
commands: if creation succeeds and joining fails, retry in the same form reuses the
created Task. Committed initial items have no draft editing controls. The initial
snapshot and Added Later groups are rendered from the server response.

The UI follows Figma node `13:2`: task groups and Schedule in the primary column,
Daily Status and Active Projects in the right rail. Intentional phase-one differences
are the explicit unavailable right-rail placeholders, no task checkboxes or view
switcher for unimplemented views, and visible creation/priority/removal/commit
controls. Fonts use Noto Sans SC / Inter when locally available, with system fallback.
Calendar Events remain unavailable in the current shared Today response.

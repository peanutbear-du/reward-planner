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

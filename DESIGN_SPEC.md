# Reward Planner — DESIGN_SPEC.md

> Status: v0.1 / Design foundation draft  
> Purpose: define the visual and interaction rules that Figma and Codex should follow consistently.  
> Source of truth: Figma is the visual source of truth; this document defines rules, intent, and implementation constraints.

---

## 1. Design Direction

### 1.1 Core style

Reward Planner uses a **Compact + Flat + Modular** visual language.

Keywords:

- Minimal
- Calm
- Graphic
- Modular
- Low-distraction
- Non-gamified
- Personal workspace rather than business dashboard

The product should feel like a focused personal planning tool, not a project-management dashboard, BI dashboard, or game.

### 1.2 Core visual idea

**Block is the main graphic language.**

Block elements represent:

- progress
- accumulation
- rhythm
- activity
- reward feedback

Typical use cases:

- Wish Grid
- Daily completion indicator
- Monthly / yearly heatmap
- Project Activity Pulse
- Reward animation / feedback

Blocks should not be used as decoration everywhere.

> Rule: use Block where it represents meaningful accumulated activity or progress; do not turn every UI element into a block.

---

## 2. Language and Locale Rules

Reward Planner supports separate Chinese and English visual variants.

### 2.1 No mixed-language screen

A single screen must use one UI language consistently.

Allowed:

- Chinese version: all UI labels, helper text, navigation, buttons, system messages in Chinese.
- English version: all UI labels, helper text, navigation, buttons, system messages in English.

Not allowed:

- “必须完成 / Must-do” on the same screen
- “日程 / Schedule” on the same screen
- “完成今日计划 / Complete plan” on the same screen

Proper nouns may remain in their original language when necessary, for example:

- IELTS
- Reward Planner
- Project names created by the user

### 2.2 Layout relationship

Chinese and English versions should share:

- information architecture
- component structure
- spacing system
- color system
- block system
- interaction behavior

They may differ slightly in:

- text width
- line wrapping
- button width
- label length

Do not force English and Chinese text into identical fixed-width text boxes when it damages readability.

---

## 3. Typography

### 3.1 Chinese UI

Primary Chinese font:

**Noto Sans SC**

Recommended hierarchy:

| Token | Use | Size | Weight | Line height |
|---|---|---:|---|---:|
| CN/Heading/1 | page title | 24px | Bold | 34px |
| CN/Heading/2 | section title | 18px | Medium | 28px |
| CN/Body/Default | task / body copy | 14px | Regular | 24px |
| CN/Label/Default | button / label | 12px | Medium | 20px |
| CN/Caption/Default | metadata | 11px | Regular | 18px |

### 3.2 English UI

Primary English font:

**Inter**

Recommended hierarchy:

| Token | Use | Size | Weight | Line height |
|---|---|---:|---|---:|
| Heading/1 | page title | 24px | Semi Bold | 32px |
| Heading/2 | section title | 18px | Medium | 26px |
| Body/Default | task / body copy | 14px | Regular | 22px |
| Label/Default | button / label | 12px | Medium | 16–18px |
| Caption/Default | metadata | 11px | Regular | 16px |

### 3.3 Numbers

Important progress numbers should use **Inter**, including in the Chinese UI.

Examples:

- `42 / 60`
- `80%`
- `+4`
- `4 / 5`

This keeps progress information visually crisp and consistent.

### 3.4 Typography rules

- Avoid overly large display headings.
- Avoid heavy bold text across large areas.
- Use hierarchy through spacing and weight before using size.
- Metadata should remain visually secondary.
- Task titles should remain easy to scan at a glance.

---

## 4. Color System

### 4.1 Neutral-first

Approximately **80–90% of the interface should remain neutral**.

Neutral colors are used for:

- background
- surface
- text
- border
- disabled states
- ordinary task rows
- calendar events

Accent color is used selectively.

### 4.2 Single Accent system

The user can select one system accent color.

Initial preset directions:

- Graphite
- Muted Blue
- Muted Green
- Muted Purple

Future presets may be added.

MVP should prefer curated presets instead of arbitrary HEX color input.

### 4.3 Accent usage

Accent is primarily used for:

- selected navigation
- progress
- Block visualizations
- active / current state
- Task scheduled as an actionable item
- Reward feedback
- primary CTA

Avoid using accent color for:

- all text
- all cards
- every Project
- every category
- decorative backgrounds

### 4.4 Theme token model

Implementation should use semantic tokens rather than hard-coded color values.

Example:

```css
--color-bg-default
--color-bg-surface
--color-bg-subtle

--color-text-primary
--color-text-secondary
--color-text-tertiary

--color-border-default

--color-accent-10
--color-accent-20
--color-accent-40
--color-accent-70
--color-accent-strong

--color-on-accent
```

Changing the user theme should primarily swap the Accent token family.

Exact values should stay synchronized with Figma Variables.

---

## 5. Spacing and Density

### 5.1 General principle

Use **intentional whitespace, not excessive whitespace**.

Whitespace should:

- separate information groups
- create readable hierarchy
- reduce visual noise

Whitespace should not:

- make ordinary content feel sparse
- create large empty dashboard zones
- force unnecessary scrolling
- exist only to make a card look “premium”

### 5.2 Desktop baseline

Recommended baseline:

| Item | Approximate value |
|---|---:|
| Sidebar width | 176–188px |
| Page horizontal padding | 32–40px |
| Major section gap | 24–28px |
| Small group gap | 8–16px |
| Task row | ~44–52px |
| Compact control height | 32–36px |
| Primary button height | 36–40px |

These are baseline values, not rigid requirements.

### 5.3 Density target

For Today desktop:

> A typical day with 5–10 Tasks and 3–5 Schedule items should be understandable mostly within the first screen.

Do not optimize for maximum density; optimize for **fast scanning without excessive scrolling**.

---

## 6. Layout Principles

### 6.1 Flat before Card

Default structural tools:

1. typography
2. spacing
3. alignment
4. divider
5. subtle background change

Use Card only after those are insufficient.

### 6.2 Avoid dashboard composition

Avoid layouts where every piece of data becomes an independent widget.

Examples to avoid:

- large Daily Completion card
- separate “80%” KPI card
- large Active Projects dashboard rail
- multiple equally weighted statistic cards

Prefer integrated information.

Example:

Instead of:

`Daily Status Card → 4 / 5 → 80% → Qualified`

Use:

`■■■■■■■■□□  80%   4 / 5   Qualified`

inside the page header or execution context.

### 6.3 Today desktop structure

Preferred direction:

```text
Sidebar

Header
├─ Date
├─ navigation
└─ compact daily status

Main execution area
├─ Tasks / Must-do / Plan
└─ Schedule

Project Focus
└─ compact horizontal project context
```

Tasks and Schedule should be visually related because both describe today's execution.

Project Focus should provide context without competing with today's tasks.

---

## 7. Card Usage

### 7.1 Default rule

**Do not use a Card by default.**

### 7.2 Usually no Card

- Must-do
- Plan
- Schedule
- navigation
- Daily Status
- section headings
- plain task groups

These should mainly use layout, typography, spacing, and subtle dividers.

### 7.3 Card is appropriate for

- Project compact object
- Wish object
- Dialog
- Popover
- isolated object with clear object identity

### 7.4 Card styling

When Cards are used:

- light border
- 8–12px radius
- little or no shadow
- moderate padding
- no large decorative gradient

Avoid stacked nested cards.

---

## 8. Block System

### 8.1 Meaning

A Block represents a unit of accumulated action, progress, or activity.

### 8.2 Shape

Baseline:

- small square / near-square
- light corner radius
- consistent gap
- dense enough to read as a system

Recommended radius:

- 3–4px for small Block
- avoid fully rounded pill-like blocks

### 8.3 Tonal scale

A Block system should use one Accent family with multiple intensity levels.

Example:

```text
Empty   → Neutral
Low     → Accent 20
Medium  → Accent 40 / 70
High    → Accent Strong
```

Avoid rainbow status scales unless there is a real semantic need.

### 8.4 Wish Grid

Wish Grid is one of the strongest visual anchors of the product.

Rules:

- fixed 60-cell visual grid
- 10 × 6 layout
- progress maps to percentage of filled cells
- target value and visual cell count are independent
- newly gained progress may animate subtly

Do not make it feel like a game board.

### 8.5 Daily completion

Daily completion may use a compact 10-block representation:

```text
■■■■■■■■□□  80%
```

The blocks represent completion percentage, not literal Task count.

Literal count remains visible separately:

`4 / 5`

### 8.6 Project Activity Pulse

Project Pulse uses Block intensity to indicate recent real activity.

It is not Project completion percentage.

---

## 9. Task and Milestone Visual Rules

### 9.1 Task

Task should remain a simple executable object.

Typical visual structure:

```text
□ Task title
  project / time / metadata
```

Rules:

- title is primary
- metadata is secondary
- checkbox is simple
- no large task cards
- completed task should remain readable

### 9.2 Must-do

Must-do should be distinguishable but not visually loud.

Possible treatment:

- slightly stronger checkbox / indicator
- subtle accent
- section hierarchy

Avoid:

- red warning styling
- oversized badges
- alarm-like visual language

### 9.3 Milestone

Milestone needs a distinct identity from Task.

Possible visual cue:

- diamond / geometric marker
- `+N` reward metadata
- stronger Accent treatment

Do not make Milestone look like a normal checkbox Task.

---

## 10. Schedule Visual Rules

Schedule should feel like part of Today rather than a separate calendar dashboard.

### 10.1 Calendar Event

Use Neutral styling.

Examples:

- class
- meeting
- appointment

Calendar Event does not contribute to Daily completion.

### 10.2 Timed Task

Use subtle Accent styling.

This communicates:

> this item occupies time and is also something the user must complete.

Do not rely only on color; the object type should remain understandable from label or iconography.

---

## 11. Motion

Motion should be:

- short
- restrained
- informative
- not celebratory by default

Recommended duration:

**100–250ms**

Good uses:

- Block fill
- task completion
- small reward progress update
- hover / selected transitions
- expanding compact UI

Avoid:

- fireworks
- coin explosions
- confetti
- exaggerated bouncing
- long page transitions

Reward may feel satisfying without becoming game-like.

---

## 12. Iconography

Direction:

- simple geometric / outline icons
- consistent stroke weight
- low visual dominance

Avoid:

- mixed icon styles
- emoji as primary navigation
- highly decorative illustrations inside utility UI

Icons support meaning; they should not become the main visual system.

---

## 13. Theme Customization

MVP theme customization changes:

**Accent color only.**

It should not radically change:

- page layout
- typography
- surface hierarchy
- component shape

Theme selection can appear in Settings.

Do not make each theme feel like a separate visual product.

---

## 14. Responsive / Multi-platform Principle

Share:

- visual identity
- Block language
- typography hierarchy
- Accent system
- core component semantics

Do not force identical layout.

Desktop:

- compact
- multi-column where useful
- higher information density

Mobile:

- vertical-first
- more spacing
- larger touch targets
- fewer simultaneous columns

Mobile is not a scaled-down Desktop screen.

---

## 15. UI States

Every core component should eventually define:

- Default
- Hover
- Pressed
- Focus
- Selected
- Disabled
- Completed where relevant
- Empty where relevant
- Loading where relevant
- Error where relevant

Do not design only the ideal filled state.

---

## 16. Design Do / Don't

### Do

- Keep the interface mostly neutral.
- Use one Accent family.
- Use Blocks for meaningful progress/activity.
- Maintain compact but readable density.
- Keep visual hierarchy clear.
- Let content determine layout.
- Keep Today focused on execution.
- Separate Chinese and English UI variants.

### Don't

- Do not overuse large empty areas.
- Do not make the product look like a BI dashboard.
- Do not wrap every section in a Card.
- Do not use large amounts of shadow.
- Do not use gradients as default decoration.
- Do not assign every Project a random color.
- Do not use XP / coin / game aesthetics.
- Do not mix Chinese and English interface copy on one screen.
- Do not let decorative Blocks reduce usability.

---

## 17. Figma → Codex Handoff Rules

Figma is the visual source of truth.

Codex should implement:

- semantic color tokens
- spacing tokens
- radius tokens
- typography tokens
- consistent reusable components
- responsive behavior described in this spec

Codex should not:

- invent a new visual system
- add additional colors without reason
- add shadows / gradients for “polish”
- convert flat sections into Cards without design approval
- mix Chinese and English copy
- change Block meaning
- redesign page density independently

If the implementation conflicts with Figma or this document:

1. identify the conflict
2. do not silently invent a solution
3. preserve product behavior
4. ask for a design decision when necessary

---

## 18. Current Screen Design Priority

High-fidelity design order:

1. Today — Desktop
2. Wish Board — Desktop
3. Week — Desktop
4. Project Detail — Desktop
5. Today — Mobile
6. remaining screens

For each key screen, create separate locale variants when needed:

```text
Today / Desktop / zh-CN
Today / Desktop / en-US
```

Do not create a hybrid bilingual master screen.

---

## 19. Open Design Questions

Not yet locked:

- final default Accent preset
- final App icon / logo
- Desktop Widget visual object
- final Reward animation
- Dark mode
- exact mobile Week layout
- final Completion Ticket visual template

These should not block the Core MVP.

---

## 20. Design Philosophy Summary

Reward Planner should feel like:

> a calm, compact personal workspace where long-term goals become visible daily action.

The product should not feel like:

> a business dashboard, project management suite, or gamified habit tracker.

Visual hierarchy should come mainly from:

**type + spacing + alignment + blocks + restrained accent**

rather than:

**large cards + decoration + excessive empty space + dashboard widgets**

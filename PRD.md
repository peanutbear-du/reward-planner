# Reward Planner — PRD.md

> Version: v0.1  
> Status: MVP product specification  
> Product definition: Reward Planner 将长期目标转化为日常行动，并通过真实执行记录和奖励反馈帮助用户持续推进重要事情。

---

## 1. Product Goal

Reward Planner is a personal planning tool for people who need to balance long-term goals with everyday execution.

Core loop:

**Project → Plan → Execution → Review → Wish**

Principles:

- Project decides direction.
- Plan drives execution.
- Review preserves truth.
- Wish provides feedback.
- The product should help users act, not only organize information.
- Reward must reflect real execution rather than superficial activity.

MVP should prove:

**Project → Daily Execution → Reward → Review**

It is not intended to become a generic productivity suite.

---

## 2. Target User

Primary users:

- students, interns, early-career professionals
- users managing multiple long-term study/work/personal goals
- users who already have some planning habit
- users who find Jira/Notion too heavy for daily personal execution

---

## 3. Product Positioning

Reward Planner is not:

- a knowledge base
- a document workspace
- a team project management system
- a habit tracker
- a gamified XP system
- a BI dashboard

It is:

> a compact personal execution system that connects long-term goals, today's work, truthful review, and meaningful reward.

---

## 4. Information Architecture

### 4.1 Plan

- Today
- Week
- Month

### 4.2 Projects

- Overview
- Project Detail

### 4.3 Wish Board

- Unlocking
- Wishlist
- Completed
- Create Wish

### 4.4 Review

- Month
- Year
- Day Review

### 4.5 Desktop-specific

- Desktop Widget

### 4.6 Reward history

- Completion Ticket

---

## 5. Today

Purpose:

> What actually needs to be completed today?

### 5.1 Sections

Today contains:

- Must-do
- Plan
- Schedule
- Project Focus / compact project context
- compact daily completion status

### 5.2 Must-do

Recommended count:

- 1–3
- may be zero

Must-do has stronger priority, but should not use alarm-like styling.

### 5.3 Plan

Plan contains ordinary executable Tasks for today.

### 5.4 Schedule

Schedule contains:

- Calendar Events
- timed Tasks

Calendar Event:

- occupies time
- does not count toward Daily completion

Timed Task:

- remains a Task
- counts toward Daily completion if it is a Daily Plan Item

### 5.5 Commit Daily Plan

User edits the Draft Today plan.

Button:

**完成今日计划 / Complete Plan**

Meaning:

- done editing the initial plan
- creates an immutable Initial Snapshot

It does NOT mean "start the day."

### 5.6 Added Later

Items added after the Initial Snapshot:

- are marked Added Later
- appear separately in Day Review
- enter the Daily completion denominator
- can contribute to Daily Qualified

### 5.7 Daily Qualification

Eligible items:

- Initial Task
- Initial Milestone
- Added Later Task
- Added Later Milestone

Calendar Events are excluded.

Let:

- N = number of eligible Daily Plan Items
- completed = number of eligible items completed on that day

Daily Qualified if:

- N > 0
- all current Must-do items are completed
- completion rate >= 80%

If there are no Must-do items:

- qualification only requires completion rate >= 80%

Reward:

- maximum one Daily Reward per day
- Daily Qualified grants +1
- 100% completion does not grant extra reward

### 5.8 Qualification reversal

Qualification is not permanently locked before Wish unlock.

If a completed task is unchecked or the day changes from qualified to unqualified:

- Daily qualification reverses
- corresponding +1 reward reverses
- active Wish progress updates accordingly

If qualification returns:

- reward can reactivate
- it must not duplicate

### 5.9 Reschedule

If an item entered today's Daily Plan and is rescheduled:

- today's Daily Plan Item remains in history
- it is marked Rescheduled
- it remains incomplete for the original day
- future schedule moves to the new date

Example:

Sep 21 exercise → rescheduled to Sep 22

Sep 21 remains:

`× Exercise · Rescheduled → Sep 22`

Completing it Sep 22 must not rewrite Sep 21 history.

---

## 6. Week

Purpose:

> Turn weekly intentions into actual scheduled execution.

Desktop layout:

- Schedule: roughly 70–80%
- Weekly Pool / Memo: roughly 20–30%

### 6.1 Weekly Pool

Weekly Pool contains Tasks known to belong to this week but without a specific date/time.

Flow:

**Weekly Pool → Date → Optional Time → Today relation when applicable**

The same Task object is reused across views.

Do not duplicate Tasks when moving between Week and Today.

### 6.2 Week Notes

Pure text notes are stored separately from executable Tasks.

### 6.3 Project important nodes

Project Deadline / Milestone Due may appear as important Week context.

Deadline is not the same as Schedule.

---

## 7. Month

Purpose:

> Show the few important events that define the month.

Month is not a normal daily calendar.

Show:

- Daily state
- Project Deadline
- Milestone Due
- Important Date / Major Event

Do not show:

- ordinary meetings
- classes
- workouts
- normal Todos

Project and Milestone dates should sync automatically.

Month is not a Review dashboard.

---

## 8. Projects Overview

Project status:

- Active
- Paused
- Completed

No Archived status in MVP.

Project card shows:

- name
- Scale
- Next Milestone
- Next Action
- Deadline
- recent Activity Pulse
- Add to Today
- Open

Do not show:

- fake completion percentage
- all milestones
- large reward dashboard

Paused Project:

- no longer appears as an active Today Project Focus
- already scheduled Tasks remain scheduled

---

## 9. Project Detail

Purpose:

> A lightweight workbench for moving a multi-step goal forward.

Contains:

- Next Milestone
- Next Action
- Milestones
- linked Tasks
- important dates
- Activity Pulse
- compact reward information

### 9.1 Next Action

Next Action is not a separate object.

It is an ordinary Task referenced by:

`next_action_task_id`

### 9.2 Milestone

Milestone:

- binary complete / incomplete
- may have due date
- receives allocated Project Reward
- may be placed in Today
- has no Definition of Done system in MVP

Completing a Milestone anywhere updates it globally.

### 9.3 Project completion

Completing all Milestones:

- prompts the user to mark the Project complete
- does not automatically complete the Project

### 9.4 Activity Pulse

Activity Pulse is based on recent real activity.

Example intensity:

- 0 = empty
- 1 = light
- 2 = medium
- 3+ = strong

Milestone completion may receive strongest intensity.

Activity Pulse is NOT project completion percentage.

---

## 10. Project Scale and Reward Pool

Project Scale:

| Scale | Reward Pool |
|---|---:|
| Small | +4 |
| Medium | +8 |
| Large | +16 |
| Major | +24 |

Scale means:

- size / effort

Scale does NOT mean:

- importance

Each Project should have at least one Milestone.

Default allocation:

- distribute Reward Pool evenly across Milestones
- remainder goes to the final Milestone

After the first Milestone is completed:

- Project Scale locks

If unfinished Milestones are added/deleted later:

- already earned reward stays fixed
- only remaining unearned pool is redistributed

Normal Project Tasks grant no reward.

Only Milestone completion grants Project reward.

---

## 11. Wish Board

Purpose:

> Make progress toward a personally meaningful reward visible.

Wish statuses:

**Wishlist → Unlocking → Unlocked → Redeemed**

Rules:

- only one Wish can be Unlocking
- unlimited Wishlist
- switching current Wish is allowed
- previous progress is preserved
- old Wish returns to Wishlist with "continue unlocking" semantics

### 11.1 Wish Grid

Wish Grid:

- fixed 60-cell visualization
- 10 × 6
- maps percentage to cells
- target may be 20 / 40 / 60 / 100 / custom
- visual grid always remains 60 cells

Grid cells represent visual progress, not literal one-point-per-cell accounting.

### 11.2 Create Wish

Required:

- Name
- Target

Optional:

- cover image
- reference price
- why

Target presets:

- 20
- 40
- 60
- 100
- Custom

Target represents effort / progression length, not price.

---

## 12. Reward System

Only two reward sources exist in MVP:

### 12.1 Daily Qualified

`+1`

### 12.2 Milestone Completed

`+N`

No reward for:

- normal Task completion
- streak
- XP
- levels
- coins
- number of clicks
- calendar events

### 12.3 Reward Event

Rewards are event-sourced.

Each Reward Event records:

- source
- amount
- time
- status

Sources:

- DAILY_QUALIFIED
- MILESTONE_COMPLETED

### 12.4 Pending Progress

If no current Unlocking Wish exists:

- reward becomes Pending Progress

Pending Progress is:

- temporary unallocated progress
- not a wallet
- not currency

Recommended MVP behavior:

When the user starts/resumes a Wish:

- Pending Progress automatically applies to the new Unlocking Wish transactionally

### 12.5 Overflow

Example:

Current Wish = 58/60  
Milestone reward = +8

Result:

- +2 applied to current Wish
- Wish becomes Unlocked
- remaining +6 becomes Pending Progress

The source Reward Event remains traceable as +8.

### 12.6 Unlock irreversibility

If historical reward later reverses:

- active non-unlocked Wish progress may decrease

But if a Wish is already Unlocked / Redeemed:

- do not relock it
- record the historical correction
- preserve reward history truth

---

## 13. Review

Review contains:

- Month
- Year

No Week Review in MVP.

### 13.1 Month Review

Possible metrics:

- Qualified Days
- Average Completion
- Longest Qualified Streak

Also show:

- Project Activity
- Wish progress earned in period
- Daily vs Milestone reward contribution

Avoid duplicating the large Wish Grid.

### 13.2 Year Review

Use a 52-week GitHub-like heatmap showing Daily execution rhythm.

Review is derived / read-only.

---

## 14. Day Review

Purpose:

> What was originally planned, and what actually happened?

Shows:

- completion stats
- Must-do result
- Qualified status
- Wish reward
- Initial Plan
- Added Later
- Schedule context
- Project impact
- reschedule history

MVP Day Review is read-only.

Historical truth should not be directly mutated.

Future correction should use correction events rather than silently changing history.

---

## 15. Desktop Widget

Widget behavior is defined; final shape is still open.

States:

- Ambient
- Hover Peek
- Pinned

### Ambient

Shows:

- current reward / progress feeling
- compact graphical state

Does NOT navigate directly to Wish Board.

### Hover Peek

Shows Today only.

- view-only
- hides when mouse leaves

### Pinned

Allows:

- check Todo
- add Todo
- open full Plan

### Reminder

At 10:30:

If there is no Today Initial Snapshot:

- desktop widget may remind the user

No automatic day lock.

### Reward feedback

Widget may show:

- Daily +1
- Milestone +N

Keep feedback restrained.

---

## 16. Completion Ticket

Generated after:

**Redeem**

Not generated merely on Unlock.

Contains:

- Wish name
- cover
- Started date
- Unlocked date
- Redeemed date
- Days to Unlock
- Qualified Days
- Milestone count
- total progress
- approximately 3 representative contributions
- one simple summary sentence

Do not prioritize total Todo count.

MVP visual:

- restrained receipt / ticket hybrid

Default shared ticket should hide detailed private Todos.

---

## 17. Core Objects

- User
- Task
- Calendar Event
- Project
- Milestone
- Planning Item
- Daily Plan
- Daily Plan Item
- Week Note
- Important Date
- Wish
- Reward Event
- Reward Allocation
- Completion Ticket

Important distinctions:

- Next Action is not a separate object.
- Weekly Memo panel is a view/container.
- Wish Grid is a visualization.
- Activity Pulse is a visualization.
- Heatmap is a visualization.

---

## 18. MVP Non-goals

Do not build in MVP:

- AI life planning
- complex automatic project generation
- collaboration
- project completion percentage
- nested Projects
- subtasks hierarchy
- Gantt
- Kanban
- docs / wiki / file workspace
- XP / levels / coins
- multiple active Wishes
- payment custody
- automatic purchase
- AI image stylization
- ticket theme marketplace
- advanced AI insights
- habit tracker
- full offline-first sync
- CRDT
- Mini Program
- mobile home-screen widget
- Plan Adjustment / Replace
- arbitrary history edits

---

## 19. Analytics Events

Suggested product events:

- `daily_plan_created`
- `task_created`
- `task_completed`
- `task_rescheduled`
- `daily_qualified`
- `daily_qualification_reversed`
- `project_created`
- `project_next_action_added_to_plan`
- `milestone_completed`
- `milestone_reversed`
- `wish_created`
- `wish_started`
- `wish_unlocked`
- `wish_redeemed`
- `review_viewed`
- `day_review_viewed`

Core metrics:

- Daily Planning Rate
- Qualified Day Rate
- Project → Plan conversion
- Reward engagement
- Review usage

---

## 20. Acceptance Examples

### Daily

Initial:

- A Must-do
- B Must-do
- C Plan
- D Plan

N = 4

Add Later:

- E

N = 5

Complete:

- A
- B
- C
- E

Result:

- 4/5 = 80%
- all Must-do complete
- Daily Qualified
- +1

Uncheck C:

- 3/5
- Daily Qualification reverses
- +1 reverses

Recheck C:

- qualifies again
- final total remains +1, not +2

### Project

Large Project:

- Reward Pool = 16
- 4 Milestones
- default = +4 each

Normal Task completion:

- +0

Milestone completion:

- +4 once globally

### Wish overflow

58 / 60  
Milestone +8

Result:

- current Wish receives +2
- current Wish unlocks
- +6 becomes Pending Progress

### Reschedule

Sep 21 exercise → Sep 22

Sep 21 Day Review:

`× Exercise · Rescheduled → Sep 22`

Completing Sep 22 does not rewrite Sep 21.

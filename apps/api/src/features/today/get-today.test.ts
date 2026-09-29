import { describe, expect, it } from "vitest";

import { getToday } from "./get-today";
import type { TodayDataSource } from "./today-data-source";

const date = "2026-09-29";

describe("getToday", () => {
  it("returns an empty Daily Plan while preserving independent timed Tasks", async () => {
    const result = await getToday(
      date,
      createDataSource({
        getTimezone: async () => null,
        getTimedPlanningItemsForDate: async () => [
          {
            id: "planning-independent",
            taskId: "task-independent",
            startTime: "09:00:00",
            endTime: "10:00:00",
          },
        ],
        getTasks: async () => [
          { id: "task-independent", title: "Independent timed Task" },
        ],
      }),
    );

    expect(result.dailyPlan).toBeNull();
    expect(result.items).toEqual({ mustDo: [], plan: [], addedLater: [] });
    expect(result.schedule.timedTasks).toEqual([
      {
        planningItemId: "planning-independent",
        dailyPlanItemId: null,
        taskId: "task-independent",
        title: "Independent timed Task",
        startTime: "09:00:00",
        endTime: "10:00:00",
        countsTowardDaily: false,
      },
    ]);
    expect(result.schedule.calendarEvents).toEqual([]);
    expect(result.dailyStatus).toEqual({ available: false });
    expect(result.activeProjects).toEqual({ available: false, items: [] });
  });

  it("uses current Task and Planning Item values for a Draft", async () => {
    const result = await getToday(
      date,
      createDataSource({
        getTimezone: async () => "Asia/Shanghai",
        getDailyPlan: async () => ({
          id: "plan-draft",
          status: "draft",
          snapshotCreatedAt: null,
        }),
        getDailyPlanItems: async () => [
          dailyItem({
            id: "item-must-do",
            taskId: "task-must-do",
            priority: "must_do",
            titleSnapshot: "Stale Must-do snapshot",
          }),
          dailyItem({
            id: "item-plan",
            taskId: "task-plan",
            titleSnapshot: "Stale Plan snapshot",
          }),
          dailyItem({
            id: "item-added-later",
            taskId: "task-added-later",
            origin: "added_later",
            priority: "must_do",
            titleSnapshot: "Stale Added Later snapshot",
          }),
        ],
        getPlanningItemsForTasks: async () => [
          {
            id: "planning-must-do",
            taskId: "task-must-do",
            startTime: "08:00:00",
            endTime: "09:00:00",
          },
          {
            id: "planning-plan",
            taskId: "task-plan",
            startTime: null,
            endTime: null,
          },
          {
            id: "planning-added-later",
            taskId: "task-added-later",
            startTime: "14:00:00",
            endTime: "15:00:00",
          },
        ],
        getTimedPlanningItemsForDate: async () => [
          {
            id: "planning-must-do",
            taskId: "task-must-do",
            startTime: "08:00:00",
            endTime: "09:00:00",
          },
          {
            id: "planning-independent",
            taskId: "task-independent",
            startTime: "16:00:00",
            endTime: null,
          },
        ],
        getTasks: async () => [
          { id: "task-must-do", title: "Current Must-do title" },
          { id: "task-plan", title: "Current Plan title" },
          { id: "task-added-later", title: "Current Added Later title" },
          { id: "task-independent", title: "Independent Task" },
        ],
      }),
    );

    expect(result.timezone).toBe("Asia/Shanghai");
    expect(result.items.mustDo[0]).toMatchObject({
      id: "item-must-do",
      title: "Current Must-do title",
      plannedStartTime: "08:00:00",
      plannedEndTime: "09:00:00",
    });
    expect(result.items.plan[0]).toMatchObject({
      id: "item-plan",
      title: "Current Plan title",
    });
    expect(result.items.addedLater).toHaveLength(1);
    expect(result.items.addedLater[0]).toMatchObject({
      id: "item-added-later",
      origin: "added_later",
      priority: "must_do",
      title: "Current Added Later title",
    });
    expect(result.schedule.timedTasks).toEqual([
      expect.objectContaining({
        taskId: "task-must-do",
        dailyPlanItemId: "item-must-do",
        countsTowardDaily: true,
      }),
      expect.objectContaining({
        taskId: "task-independent",
        dailyPlanItemId: null,
        countsTowardDaily: false,
      }),
    ]);
  });

  it("uses frozen title and time snapshots for a committed plan", async () => {
    const result = await getToday(
      date,
      createDataSource({
        getDailyPlan: async () => ({
          id: "plan-committed",
          status: "committed",
          snapshotCreatedAt: "2026-09-29T01:00:00.000Z",
        }),
        getDailyPlanItems: async () => [
          dailyItem({
            id: "item-committed",
            taskId: "task-committed",
            titleSnapshot: "Frozen title",
            plannedStartTimeSnapshot: "10:00:00",
            plannedEndTimeSnapshot: "11:00:00",
          }),
        ],
        getTimedPlanningItemsForDate: async () => [
          {
            id: "planning-committed",
            taskId: "task-committed",
            startTime: "17:00:00",
            endTime: "18:00:00",
          },
        ],
        getTasks: async () => [
          { id: "task-committed", title: "Changed global title" },
        ],
      }),
    );

    expect(result.items.plan[0]).toMatchObject({
      title: "Frozen title",
      plannedStartTime: "10:00:00",
      plannedEndTime: "11:00:00",
    });
    expect(result.schedule.timedTasks[0]).toMatchObject({
      taskId: "task-committed",
      title: "Changed global title",
      startTime: "17:00:00",
      dailyPlanItemId: "item-committed",
      countsTowardDaily: true,
    });
  });
});

function createDataSource(
  overrides: Partial<TodayDataSource> = {},
): TodayDataSource {
  return {
    getTimezone: async () => null,
    getDailyPlan: async () => null,
    getDailyPlanItems: async () => [],
    getPlanningItemsForTasks: async () => [],
    getTimedPlanningItemsForDate: async () => [],
    getTasks: async () => [],
    ...overrides,
  };
}

function dailyItem(
  overrides: Partial<Awaited<ReturnType<TodayDataSource["getDailyPlanItems"]>>[number]> = {},
) {
  return {
    id: "daily-item",
    taskId: "task",
    origin: "initial" as const,
    priority: "plan" as const,
    resultStatus: "pending" as const,
    titleSnapshot: "Snapshot title",
    plannedStartTimeSnapshot: null,
    plannedEndTimeSnapshot: null,
    completedAtOnDay: null,
    rescheduledToDate: null,
    ...overrides,
  };
}

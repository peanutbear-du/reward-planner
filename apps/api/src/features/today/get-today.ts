import type { TodayItem, TodayResponse } from "@reward-planner/types";

import type {
  DailyPlanItemRecord,
  PlanningItemRecord,
  TaskRecord,
  TodayDataSource,
} from "./today-data-source";

export async function getToday(
  date: string,
  dataSource: TodayDataSource,
): Promise<TodayResponse> {
  const [timezone, dailyPlan, timedPlanningItems] = await Promise.all([
    dataSource.getTimezone(),
    dataSource.getDailyPlan(date),
    dataSource.getTimedPlanningItemsForDate(date),
  ]);
  const dailyPlanItems = dailyPlan
    ? await dataSource.getDailyPlanItems(dailyPlan.id)
    : [];
  const draftPlanningItems =
    dailyPlan?.status === "draft"
      ? await dataSource.getPlanningItemsForTasks(
          dailyPlanItems.map((item) => item.taskId),
        )
      : [];
  const taskIds = unique([
    ...dailyPlanItems.map((item) => item.taskId),
    ...timedPlanningItems.map((item) => item.taskId),
  ]);
  const tasks = await dataSource.getTasks(taskIds);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const planningItemsByTaskId = new Map(
    draftPlanningItems.map((item) => [item.taskId, item]),
  );
  const dailyPlanItemsByTaskId = new Map(
    dailyPlanItems.map((item) => [item.taskId, item]),
  );
  const items: TodayResponse["items"] = {
    mustDo: [],
    plan: [],
    addedLater: [],
  };

  for (const item of dailyPlanItems) {
    const todayItem = toTodayItem(
      item,
      dailyPlan?.status === "committed",
      tasksById,
      planningItemsByTaskId,
    );

    if (item.origin === "added_later") {
      items.addedLater.push(todayItem);
    } else if (item.priority === "must_do") {
      items.mustDo.push(todayItem);
    } else {
      items.plan.push(todayItem);
    }
  }

  return {
    date,
    timezone,
    dailyPlan: dailyPlan
      ? {
          id: dailyPlan.id,
          status: dailyPlan.status,
          snapshotCreatedAt: dailyPlan.snapshotCreatedAt,
        }
      : null,
    items,
    schedule: {
      timedTasks: timedPlanningItems.map((planningItem) => {
        const dailyPlanItem = dailyPlanItemsByTaskId.get(planningItem.taskId);

        return {
          planningItemId: planningItem.id,
          dailyPlanItemId: dailyPlanItem?.id ?? null,
          taskId: planningItem.taskId,
          title: getTaskTitle(planningItem.taskId, tasksById),
          startTime: planningItem.startTime,
          endTime: planningItem.endTime,
          countsTowardDaily: Boolean(dailyPlanItem),
        };
      }),
      calendarEvents: [],
    },
    dailyStatus: {
      available: false,
    },
    activeProjects: {
      available: false,
      items: [],
    },
  };
}

function toTodayItem(
  item: DailyPlanItemRecord,
  isCommitted: boolean,
  tasksById: Map<string, TaskRecord>,
  planningItemsByTaskId: Map<string, PlanningItemRecord>,
): TodayItem {
  const planningItem = planningItemsByTaskId.get(item.taskId);

  return {
    id: item.id,
    taskId: item.taskId,
    origin: item.origin,
    priority: item.priority,
    resultStatus: item.resultStatus,
    title: isCommitted
      ? item.titleSnapshot
      : getTaskTitle(item.taskId, tasksById),
    plannedStartTime: isCommitted
      ? item.plannedStartTimeSnapshot
      : planningItem?.startTime ?? null,
    plannedEndTime: isCommitted
      ? item.plannedEndTimeSnapshot
      : planningItem?.endTime ?? null,
    completedAtOnDay: item.completedAtOnDay,
    rescheduledToDate: item.rescheduledToDate,
  };
}

function getTaskTitle(taskId: string, tasksById: Map<string, TaskRecord>) {
  const task = tasksById.get(taskId);

  if (!task) {
    throw new Error("A Task referenced by Today data could not be read.");
  }

  return task.title;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

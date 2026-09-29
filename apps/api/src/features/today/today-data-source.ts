import type {
  DailyPlanItemOrigin,
  DailyPlanItemPriority,
  DailyPlanItemResultStatus,
  DailyPlanStatus,
} from "@reward-planner/types";

export interface DailyPlanRecord {
  id: string;
  status: DailyPlanStatus;
  snapshotCreatedAt: string | null;
}

export interface DailyPlanItemRecord {
  id: string;
  taskId: string;
  origin: DailyPlanItemOrigin;
  priority: DailyPlanItemPriority;
  resultStatus: DailyPlanItemResultStatus;
  titleSnapshot: string;
  plannedStartTimeSnapshot: string | null;
  plannedEndTimeSnapshot: string | null;
  completedAtOnDay: string | null;
  rescheduledToDate: string | null;
}

export interface PlanningItemRecord {
  id: string;
  taskId: string;
  startTime: string | null;
  endTime: string | null;
}

export interface TimedPlanningItemRecord extends PlanningItemRecord {
  startTime: string;
}

export interface TaskRecord {
  id: string;
  title: string;
}

export interface TodayDataSource {
  getTimezone(): Promise<string | null>;
  getDailyPlan(date: string): Promise<DailyPlanRecord | null>;
  getDailyPlanItems(dailyPlanId: string): Promise<DailyPlanItemRecord[]>;
  getPlanningItemsForTasks(taskIds: string[]): Promise<PlanningItemRecord[]>;
  getTimedPlanningItemsForDate(date: string): Promise<TimedPlanningItemRecord[]>;
  getTasks(taskIds: string[]): Promise<TaskRecord[]>;
}

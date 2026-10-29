import type {
  DailyPlanItemOrigin,
  DailyPlanItemPriority,
  DailyPlanItemResultStatus,
  DailyPlanStatus,
  DailyQualification,
} from "@reward-planner/types";

export interface DailyPlanRecord extends DailyQualification {
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
  status: "open" | "completed";
  projectId: string | null;
  milestoneId: string | null;
}

export interface TodayDataSource {
  getTimezone(): Promise<string | null>;
  getDailyPlan(date: string): Promise<DailyPlanRecord | null>;
  getDailyPlanItems(dailyPlanId: string): Promise<DailyPlanItemRecord[]>;
  getPlanningItemsForTasks(taskIds: string[], date: string): Promise<PlanningItemRecord[]>;
  getTimedPlanningItemsForDate(date: string): Promise<TimedPlanningItemRecord[]>;
  getTasks(taskIds: string[]): Promise<TaskRecord[]>;
}

export type DailyPlanStatus = "draft" | "committed";

export type DailyPlanItemOrigin = "initial" | "added_later";

export type DailyPlanItemPriority = "must_do" | "plan";

export type DailyPlanItemResultStatus =
  | "pending"
  | "completed"
  | "rescheduled"
  | "cancelled"
  | "incomplete";

export interface TodayItem {
  id: string;
  taskId: string;
  origin: DailyPlanItemOrigin;
  priority: DailyPlanItemPriority;
  resultStatus: DailyPlanItemResultStatus;
  title: string;
  plannedStartTime: string | null;
  plannedEndTime: string | null;
  completedAtOnDay: string | null;
  rescheduledToDate: string | null;
}

export interface ScheduleTask {
  planningItemId: string;
  dailyPlanItemId: string | null;
  taskId: string;
  title: string;
  startTime: string;
  endTime: string | null;
  countsTowardDaily: boolean;
}

export interface TodayResponse {
  date: string;
  timezone: string | null;
  dailyPlan: {
    id: string;
    status: DailyPlanStatus;
    snapshotCreatedAt: string | null;
  } | null;
  items: {
    mustDo: TodayItem[];
    plan: TodayItem[];
    addedLater: TodayItem[];
  };
  schedule: {
    timedTasks: ScheduleTask[];
    calendarEvents: [];
  };
  dailyStatus: {
    available: false;
  };
  activeProjects: {
    available: false;
    items: [];
  };
}

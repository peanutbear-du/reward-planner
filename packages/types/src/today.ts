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

/** Persisted by the database from per-day Items; never derived by a client. */
export interface DailyQualification {
  totalItems: number;
  completedItems: number;
  mustDoItems: number;
  completedMustDoItems: number;
  completionRate: number;
  isQualified: boolean;
  qualifiedAt: string | null;
  calculatedAt: string | null;
}

export type DailyStatus =
  | { available: false; reason: "no_plan" | "draft" }
  | ({ available: true } & DailyQualification);

export interface TodayResponse {
  date: string;
  timezone: string | null;
  execution: {
    currentDate: string;
    available: boolean;
  };
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
  dailyStatus: DailyStatus;
  activeProjects: {
    available: false;
    items: [];
  };
}

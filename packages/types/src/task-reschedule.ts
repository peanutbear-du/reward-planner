export interface TaskRescheduleRequest {
  date: string;
  taskId: string;
  targetDate: string;
}

export interface TaskRescheduleData extends TaskRescheduleRequest {
  dailyPlanId: string;
  itemId: string;
  resultStatus: "rescheduled";
  changed: boolean;
}

export interface TaskRescheduleResponse {
  data: TaskRescheduleData;
  effects: [] | ["task_rescheduled"];
}

export type TaskRescheduleErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "DAILY_PLAN_NOT_FOUND"
  | "DAILY_PLAN_NOT_COMMITTED"
  | "TASK_NOT_FOUND"
  | "DAILY_ITEM_NOT_FOUND"
  | "TASK_RESCHEDULE_NOT_ALLOWED"
  | "DAILY_ITEM_RESCHEDULE_NOT_ALLOWED"
  | "TASK_ALREADY_RESCHEDULED"
  | "INVALID_RESCHEDULE_DATE"
  | "RESCHEDULE_TARGET_CONFLICT"
  | "RESCHEDULE_PLANNING_CONFLICT"
  | "INVALID_USER_TIMEZONE";

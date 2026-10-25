export interface TaskExecutionRequest {
  taskId: string;
  date: string;
}

export interface TaskExecutionData {
  date: string;
  changed: boolean;
  task: {
    id: string;
    status: "open" | "completed";
    completedAt: string | null;
    updatedAt: string;
  };
  item: {
    id: string;
    taskId: string;
    resultStatus: "pending" | "completed";
    completedAtOnDay: string | null;
  };
}

export interface TaskExecutionResponse {
  data: TaskExecutionData;
  effects: [] | ["task_completed"] | ["task_uncompleted"];
}

export type TaskExecutionErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "TASK_NOT_FOUND"
  | "DAILY_PLAN_NOT_FOUND"
  | "DAILY_ITEM_NOT_FOUND"
  | "DAILY_PLAN_NOT_COMMITTED"
  | "TASK_DATE_NOT_CURRENT"
  | "DAILY_ITEM_EXECUTION_NOT_ALLOWED"
  | "INVALID_USER_TIMEZONE";

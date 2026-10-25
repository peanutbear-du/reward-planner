import type { TaskExecutionData, TaskExecutionErrorCode } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TaskExecutionCommandError, type TaskExecutionCommand } from "./task-execution";

const domainErrors = new Set<TaskExecutionErrorCode>([
  "AUTHENTICATION_REQUIRED", "TASK_NOT_FOUND", "DAILY_PLAN_NOT_FOUND", "DAILY_ITEM_NOT_FOUND",
  "DAILY_PLAN_NOT_COMMITTED", "TASK_DATE_NOT_CURRENT", "DAILY_ITEM_EXECUTION_NOT_ALLOWED", "INVALID_USER_TIMEZONE",
]);

export function createSupabaseTaskExecutionCommand(supabase: SupabaseClient): TaskExecutionCommand {
  return {
    async execute(input, completed) {
      const { data, error } = await supabase.rpc("set_task_completion", {
        p_date: input.date, p_task_id: input.taskId, p_completed: completed,
      });
      if (error) {
        if (domainErrors.has(error.message as TaskExecutionErrorCode)) {
          throw new TaskExecutionCommandError(error.message as TaskExecutionErrorCode);
        }
        throw new Error("Failed to execute the Task execution command.", { cause: error });
      }
      if (!isExecutionData(data, completed) || data.date !== input.date
        || data.task.id !== input.taskId || data.item.taskId !== input.taskId) {
        throw new Error("Task execution returned an invalid result.");
      }
      return data;
    },
  };
}

function isExecutionData(value: unknown, completed: boolean): value is TaskExecutionData {
  if (!isRecord(value) || !isRecord(value.task) || !isRecord(value.item)) return false;
  return typeof value.date === "string" && typeof value.changed === "boolean"
    && typeof value.task.id === "string" && typeof value.task.updatedAt === "string"
    && value.task.status === (completed ? "completed" : "open")
    && (completed ? typeof value.task.completedAt === "string" : value.task.completedAt === null)
    && typeof value.item.id === "string" && typeof value.item.taskId === "string"
    && value.item.resultStatus === (completed ? "completed" : "pending")
    && (completed ? typeof value.item.completedAtOnDay === "string" : value.item.completedAtOnDay === null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

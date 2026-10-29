import type { TaskRescheduleData, TaskRescheduleErrorCode } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TaskRescheduleCommandError, type TaskRescheduleCommand } from "./task-reschedule";

const domainErrors = new Set<TaskRescheduleErrorCode>([
  "AUTHENTICATION_REQUIRED", "DAILY_PLAN_NOT_FOUND", "DAILY_PLAN_NOT_COMMITTED", "TASK_NOT_FOUND", "DAILY_ITEM_NOT_FOUND",
  "TASK_RESCHEDULE_NOT_ALLOWED", "DAILY_ITEM_RESCHEDULE_NOT_ALLOWED", "TASK_ALREADY_RESCHEDULED",
  "INVALID_RESCHEDULE_DATE", "RESCHEDULE_TARGET_CONFLICT", "RESCHEDULE_PLANNING_CONFLICT", "INVALID_USER_TIMEZONE",
]);

export function createSupabaseTaskRescheduleCommand(supabase: SupabaseClient): TaskRescheduleCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("reschedule_task", {
        p_date: input.date, p_task_id: input.taskId, p_target_date: input.targetDate,
      });
      if (error) {
        if (domainErrors.has(error.message as TaskRescheduleErrorCode)) throw new TaskRescheduleCommandError(error.message as TaskRescheduleErrorCode);
        throw new Error("Failed to execute the Task reschedule command.", { cause: error });
      }
      if (!isData(data) || data.date !== input.date || data.taskId !== input.taskId || data.targetDate !== input.targetDate) {
        throw new Error("Task reschedule returned an invalid result.");
      }
      return data;
    },
  };
}

function isData(value: unknown): value is TaskRescheduleData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return typeof data.date === "string" && typeof data.taskId === "string" && typeof data.targetDate === "string"
    && typeof data.dailyPlanId === "string" && typeof data.itemId === "string"
    && data.resultStatus === "rescheduled" && typeof data.changed === "boolean";
}

import type {
  CreateTaskResponse,
  TaskPlanningItemDto,
} from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CreateTaskCommand } from "./create-task";

export function createSupabaseCreateTaskCommand(
  supabase: SupabaseClient,
): CreateTaskCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("create_task", {
        p_end_time: input.schedule?.endTime ?? null,
        p_planned_date: input.schedule?.plannedDate ?? null,
        p_start_time: input.schedule?.startTime ?? null,
        p_title: input.title,
      });

      if (error) {
        throw new Error("Failed to execute the Create Task command.", {
          cause: error,
        });
      }

      return parseCreateTaskRpcResult(data);
    },
  };
}

function parseCreateTaskRpcResult(value: unknown): CreateTaskResponse["data"] {
  if (!isRecord(value) || !isTask(value.task)) {
    throw new Error("Create Task returned an invalid result.");
  }

  if (value.planningItem !== null && !isPlanningItem(value.planningItem)) {
    throw new Error("Create Task returned an invalid Planning Item.");
  }

  return {
    task: value.task,
    planningItem: value.planningItem as TaskPlanningItemDto | null,
  };
}

function isTask(value: unknown): value is CreateTaskResponse["data"]["task"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    value.status === "open" &&
    value.completedAt === null &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isPlanningItem(value: unknown): value is TaskPlanningItemDto {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.taskId === "string" &&
    typeof value.plannedDate === "string" &&
    isNullableString(value.startTime) &&
    isNullableString(value.endTime) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

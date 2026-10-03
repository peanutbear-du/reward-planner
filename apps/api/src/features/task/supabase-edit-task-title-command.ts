import type { EditTaskTitleResponse } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EditTaskTitleCommand } from "./edit-task-title";
import { throwTaskRpcError } from "./task-command-error";

export function createSupabaseEditTaskTitleCommand(
  supabase: SupabaseClient,
): EditTaskTitleCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("edit_task_title", {
        p_task_id: input.taskId,
        p_title: input.title,
      });

      if (error) {
        throwTaskRpcError(error, "TASK_EDIT_NOT_ALLOWED", "Edit Task");
      }

      return parseEditTaskTitleRpcResult(data);
    },
  };
}

function parseEditTaskTitleRpcResult(
  value: unknown,
): EditTaskTitleResponse["data"] {
  if (!isRecord(value) || !isTask(value.task)) {
    throw new Error("Edit Task returned an invalid result.");
  }

  return { task: value.task };
}

function isTask(
  value: unknown,
): value is EditTaskTitleResponse["data"]["task"] {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

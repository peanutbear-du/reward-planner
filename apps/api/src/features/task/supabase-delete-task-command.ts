import type { DeleteTaskResponse } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DeleteTaskCommand } from "./delete-task";
import { throwTaskRpcError } from "./task-command-error";

export function createSupabaseDeleteTaskCommand(
  supabase: SupabaseClient,
): DeleteTaskCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("delete_task", {
        p_task_id: input.taskId,
      });

      if (error) {
        throwTaskRpcError(error, "TASK_DELETE_NOT_ALLOWED", "Delete Task");
      }

      return parseDeleteTaskRpcResult(data, input.taskId);
    },
  };
}

function parseDeleteTaskRpcResult(
  value: unknown,
  expectedTaskId: string,
): DeleteTaskResponse["data"] {
  if (
    !isRecord(value) ||
    typeof value.taskId !== "string" ||
    value.taskId !== expectedTaskId
  ) {
    throw new Error("Delete Task returned an invalid result.");
  }

  return { taskId: value.taskId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

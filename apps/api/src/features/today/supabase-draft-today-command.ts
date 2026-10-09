import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DraftTodayCommandError,
  type UpsertDraftTodayItemCommand,
  type RemoveDraftTodayItemCommand,
} from "./draft-today";

export function createSupabaseUpsertDraftTodayItemCommand(
  supabase: SupabaseClient,
): UpsertDraftTodayItemCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("upsert_draft_today_item", {
        p_date: input.date,
        p_task_id: input.taskId,
        p_priority: input.priority,
      });
      if (error) {
        throwRpcError(error);
      }
      if (
        !isRecord(data) || typeof data.dailyPlanId !== "string" ||
        !isRecord(data.item) || typeof data.item.id !== "string" ||
        data.item.taskId !== input.taskId || data.item.origin !== "initial" ||
        data.item.priority !== input.priority || data.item.resultStatus !== "pending"
      ) {
        throw new Error("Draft Today returned an invalid upsert result.");
      }
      return {
        dailyPlanId: data.dailyPlanId,
        item: {
          id: data.item.id,
          taskId: input.taskId,
          origin: "initial",
          priority: input.priority,
          resultStatus: "pending",
        },
      };
    },
  };
}

export function createSupabaseRemoveDraftTodayItemCommand(
  supabase: SupabaseClient,
): RemoveDraftTodayItemCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("remove_draft_today_item", {
        p_date: input.date,
        p_task_id: input.taskId,
      });
      if (error) {
        throwRpcError(error);
      }
      if (
        !isRecord(data) || typeof data.dailyPlanId !== "string" ||
        data.taskId !== input.taskId
      ) {
        throw new Error("Draft Today returned an invalid removal result.");
      }
      return { dailyPlanId: data.dailyPlanId, taskId: input.taskId };
    },
  };
}

function throwRpcError(error: unknown): never {
  if (isRecord(error)) {
    switch (error.message) {
      case "TASK_NOT_FOUND":
      case "DRAFT_ITEM_NOT_FOUND":
      case "DAILY_PLAN_ALREADY_COMMITTED":
      case "TASK_NOT_DRAFT_ELIGIBLE":
      case "DRAFT_ITEM_NOT_INITIAL":
        throw new DraftTodayCommandError(error.message);
    }
  }
  throw new Error("Failed to execute the Draft Today command.", { cause: error });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

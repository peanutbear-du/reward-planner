import type { AddLaterResponse } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AddLaterCommandError, type AddLaterCommand } from "./add-later";

export function createSupabaseAddLaterCommand(supabase: SupabaseClient): AddLaterCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("add_later_today_item", {
        p_date: input.date,
        p_task_id: input.taskId,
        p_priority: input.priority,
      });
      if (error) {
        switch (error.message) {
          case "DAILY_PLAN_NOT_FOUND":
          case "DAILY_PLAN_NOT_COMMITTED":
          case "TASK_NOT_FOUND":
          case "TASK_NOT_ADDED_LATER_ELIGIBLE":
          case "INITIAL_ITEM_ALREADY_EXISTS":
            throw new AddLaterCommandError(error.message);
        }
        throw new Error("Failed to execute the Added Later command.", { cause: error });
      }
      if (!isRecord(data) || typeof data.dailyPlanId !== "string" || !isAddedLaterItem(data.item)
        || data.item.taskId !== input.taskId) {
        throw new Error("Added Later returned an invalid result.");
      }
      // On a retry the original priority and frozen values are authoritative.
      return { dailyPlanId: data.dailyPlanId, item: data.item };
    },
  };
}

function isAddedLaterItem(value: unknown): value is AddLaterResponse["data"]["item"] {
  return isRecord(value) && typeof value.id === "string" &&
    typeof value.taskId === "string" && value.origin === "added_later" &&
    (value.priority === "must_do" || value.priority === "plan") &&
    (value.resultStatus === "pending" || value.resultStatus === "completed" ||
      value.resultStatus === "rescheduled" || value.resultStatus === "cancelled" || value.resultStatus === "incomplete") &&
    typeof value.title === "string" && isNullableString(value.plannedStartTime) &&
    isNullableString(value.plannedEndTime) && isNullableString(value.completedAtOnDay) &&
    isNullableString(value.rescheduledToDate);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CancelDailyItemData, CancelDailyItemErrorCode } from "@reward-planner/types";
import { CancelDailyItemCommandError, type CancelDailyItemCommand } from "./cancel-daily-item";

const domainErrors = new Set<CancelDailyItemErrorCode>([
  "AUTHENTICATION_REQUIRED", "INVALID_CANCEL_REQUEST", "DAILY_PLAN_NOT_FOUND",
  "DAILY_PLAN_NOT_COMMITTED", "DAILY_ITEM_NOT_FOUND", "DAILY_ITEM_CANCEL_NOT_ALLOWED",
]);

export function createSupabaseCancelDailyItemCommand(supabase: SupabaseClient): CancelDailyItemCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("cancel_daily_item", { p_date: input.date, p_item_id: input.itemId });
      if (error) {
        if (domainErrors.has(error.message as CancelDailyItemErrorCode)) throw new CancelDailyItemCommandError(error.message as CancelDailyItemErrorCode);
        throw new Error("Failed to execute the Cancel Daily Item command.", { cause: error });
      }
      if (!isData(data) || data.date !== input.date || data.itemId !== input.itemId) {
        throw new Error("Cancel Daily Item returned an invalid result.");
      }
      return data;
    },
  };
}

function isData(value: unknown): value is CancelDailyItemData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return typeof data.date === "string" && typeof data.itemId === "string" && typeof data.dailyPlanId === "string"
    && data.resultStatus === "cancelled" && typeof data.changed === "boolean";
}

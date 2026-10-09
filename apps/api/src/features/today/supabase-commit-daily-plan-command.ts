import type { SupabaseClient } from "@supabase/supabase-js";

import { CommitDailyPlanCommandError, type CommitDailyPlanCommand } from "./commit-daily-plan";

export function createSupabaseCommitDailyPlanCommand(
  supabase: SupabaseClient,
): CommitDailyPlanCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("commit_daily_plan", {
        p_date: input.date,
      });
      if (error) {
        switch (error.message) {
          case "DAILY_PLAN_NOT_FOUND":
          case "DAILY_PLAN_EMPTY":
          case "DAILY_PLAN_ITEMS_INVALID":
            throw new CommitDailyPlanCommandError(error.message);
        }
        throw new Error("Failed to execute the Commit Daily Plan command.", { cause: error });
      }
      if (
        !isRecord(data) || data.date !== input.date ||
        !isRecord(data.dailyPlan) || typeof data.dailyPlan.id !== "string" ||
        data.dailyPlan.status !== "committed" ||
        typeof data.dailyPlan.snapshotCreatedAt !== "string"
      ) {
        throw new Error("Commit Daily Plan returned an invalid result.");
      }
      return {
        date: input.date,
        dailyPlan: {
          id: data.dailyPlan.id,
          status: "committed",
          snapshotCreatedAt: data.dailyPlan.snapshotCreatedAt,
        },
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import type { CommitDailyPlanResponse } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { executeCommitDailyPlan } from "./commit-daily-plan";
import { createSupabaseCommitDailyPlanCommand } from "./supabase-commit-daily-plan-command";

const data: CommitDailyPlanResponse["data"] = {
  date: "2026-10-09", dailyPlan: { id: "plan", status: "committed", snapshotCreatedAt: "2026-10-09T01:00:00Z" },
};

describe("Commit Daily Plan command", () => {
  it("uses the caller's narrow RPC and emits only the committed effect", async () => {
    const rpc = vi.fn(async () => ({ data, error: null }));
    const command = createSupabaseCommitDailyPlanCommand({ rpc } as unknown as SupabaseClient);
    expect(await executeCommitDailyPlan({ date: data.date }, command)).toEqual({
      data, effects: ["daily_plan_committed"],
    });
    expect(rpc).toHaveBeenCalledWith("commit_daily_plan", { p_date: data.date });
  });

  it.each([
    ["DAILY_PLAN_NOT_FOUND", 404], ["DAILY_PLAN_EMPTY", 409], ["DAILY_PLAN_ITEMS_INVALID", 409],
  ])("maps %s to the expected %s business error", async (message, status) => {
    const client = { rpc: async () => ({ data: null, error: { message } }) } as unknown as SupabaseClient;
    await expect(createSupabaseCommitDailyPlanCommand(client).execute({ date: data.date }))
      .rejects.toMatchObject({ code: message, status });
  });

  it("wraps unexpected DB failures without exposing them", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "private SQL detail" } }) } as unknown as SupabaseClient;
    await expect(createSupabaseCommitDailyPlanCommand(client).execute({ date: data.date }))
      .rejects.toThrow("Failed to execute the Commit Daily Plan command.");
  });

  it.each([
    null, {}, { ...data, date: "2026-10-10" },
    { ...data, dailyPlan: { ...data.dailyPlan, status: "draft" } },
    { ...data, dailyPlan: { ...data.dailyPlan, snapshotCreatedAt: null } },
  ])("rejects malformed RPC result %#", async (invalid) => {
    const client = { rpc: async () => ({ data: invalid, error: null }) } as unknown as SupabaseClient;
    await expect(createSupabaseCommitDailyPlanCommand(client).execute({ date: data.date }))
      .rejects.toThrow("Commit Daily Plan returned an invalid result.");
  });
});

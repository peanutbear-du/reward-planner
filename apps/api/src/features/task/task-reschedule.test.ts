import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskRescheduleData, TaskRescheduleErrorCode } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";
import { executeTaskReschedule } from "./task-reschedule";
import { createSupabaseTaskRescheduleCommand } from "./supabase-task-reschedule-command";

const input = { date: "2026-09-21", taskId: "10000000-0000-4000-8000-000000000001", targetDate: "2026-09-22" };
const result: TaskRescheduleData = { ...input, dailyPlanId: "plan", itemId: "item", resultStatus: "rescheduled", changed: true };
describe("Task reschedule command", () => {
  it.each([true, false])("uses one RPC, effects respect persisted change=%s", async (changed) => {
    const data = { ...result, changed };
    const rpc = vi.fn(async () => ({ data, error: null }));
    expect(await executeTaskReschedule(input, createSupabaseTaskRescheduleCommand({ rpc } as unknown as SupabaseClient)))
      .toEqual({ data, effects: changed ? ["task_rescheduled"] : [] });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reschedule_task", { p_date: input.date, p_task_id: input.taskId, p_target_date: input.targetDate });
  });
  it.each<TaskRescheduleErrorCode>([
    "AUTHENTICATION_REQUIRED", "DAILY_PLAN_NOT_FOUND", "DAILY_PLAN_NOT_COMMITTED", "TASK_NOT_FOUND", "DAILY_ITEM_NOT_FOUND",
    "TASK_RESCHEDULE_NOT_ALLOWED", "DAILY_ITEM_RESCHEDULE_NOT_ALLOWED", "TASK_ALREADY_RESCHEDULED", "INVALID_RESCHEDULE_DATE",
    "RESCHEDULE_TARGET_CONFLICT", "RESCHEDULE_PLANNING_CONFLICT", "INVALID_USER_TIMEZONE",
  ])("preserves domain error %s", async (message) => {
    await expect(createSupabaseTaskRescheduleCommand({ rpc: async () => ({ error: { message } }) } as unknown as SupabaseClient).execute(input)).rejects.toMatchObject({ code: message });
  });
  it.each([null, {}, { ...result, date: "other" }, { ...result, taskId: "foreign" }, { ...result, targetDate: "other" },
    { ...result, changed: "true" }, { ...result, resultStatus: "pending" }, { ...result, itemId: null }, { ...result, dailyPlanId: null },
  ])("rejects malformed or mismatched result %#", async (data) => {
    await expect(createSupabaseTaskRescheduleCommand({ rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient).execute(input)).rejects.toThrow("invalid result");
  });
  it("hides unexpected database details", async () => {
    await expect(createSupabaseTaskRescheduleCommand({ rpc: async () => ({ error: { message: "private SQL" } }) } as unknown as SupabaseClient).execute(input)).rejects.toThrow("Failed to execute the Task reschedule command.");
  });
});

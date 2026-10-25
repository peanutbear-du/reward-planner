import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskExecutionData, TaskExecutionErrorCode } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";
import { executeTaskExecution } from "./task-execution";
import { createSupabaseTaskExecutionCommand } from "./supabase-task-execution-command";

const input = { taskId: "10000000-0000-4000-8000-000000000001", date: "2026-10-25" };
function result(completed: boolean, changed = true): TaskExecutionData {
  const time = completed ? "2026-10-25T02:00:00Z" : null;
  return { date: input.date, changed,
    task: { id: input.taskId, status: completed ? "completed" : "open", completedAt: time, updatedAt: "2026-10-25T02:00:00Z" },
    item: { id: "daily-item", taskId: input.taskId, resultStatus: completed ? "completed" : "pending", completedAtOnDay: time },
  };
}
describe("Task execution command", () => {
  it.each([true, false])("calls one authenticated atomic RPC (completed=%s)", async (completed) => {
    const data = result(completed);
    const rpc = vi.fn(async () => ({ data, error: null }));
    const command = createSupabaseTaskExecutionCommand({ rpc } as unknown as SupabaseClient);
    expect(await executeTaskExecution(input, completed, command)).toEqual({ data, effects: [completed ? "task_completed" : "task_uncompleted"] });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_task_completion", { p_date: input.date, p_task_id: input.taskId, p_completed: completed });
  });
  it.each([true, false])("emits no transition effect on an idempotent retry (completed=%s)", async (completed) => {
    const data = result(completed, false);
    expect(await executeTaskExecution(input, completed, { execute: async () => data })).toEqual({ data, effects: [] });
  });
  it.each<TaskExecutionErrorCode>([
    "AUTHENTICATION_REQUIRED", "TASK_NOT_FOUND", "DAILY_PLAN_NOT_FOUND", "DAILY_ITEM_NOT_FOUND",
    "DAILY_PLAN_NOT_COMMITTED", "TASK_DATE_NOT_CURRENT", "DAILY_ITEM_EXECUTION_NOT_ALLOWED", "INVALID_USER_TIMEZONE",
  ])("preserves domain failure %s", async (message) => {
    const rpc = vi.fn(async () => ({ data: null, error: { message } }));
    await expect(createSupabaseTaskExecutionCommand({ rpc } as unknown as SupabaseClient).execute(input, true)).rejects.toMatchObject({ code: message });
  });
  it.each([
    {}, { ...result(true), date: "2026-10-24" },
    { ...result(true), task: { ...result(true).task, id: "wrong-task" } },
    { ...result(true), item: { ...result(true).item, taskId: "wrong-task" } },
    { ...result(true), item: { ...result(true).item, completedAtOnDay: null } },
    result(false),
  ])("rejects malformed or mismatched results %#", async (data) => {
    await expect(createSupabaseTaskExecutionCommand({ rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient).execute(input, true)).rejects.toThrow("invalid result");
  });
  it("does not expose unexpected database details as a domain error", async () => {
    await expect(createSupabaseTaskExecutionCommand({ rpc: async () => ({ data: null, error: { message: "private SQL detail" } }) } as unknown as SupabaseClient).execute(input, true)).rejects.toThrow("Failed to execute the Task execution command.");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { TaskRescheduleErrorCode, TaskRescheduleResponse } from "@reward-planner/types";
import type { AuthenticatedRequestContext } from "../../../../auth/authenticated-request";
import { TaskRescheduleCommandError } from "../../../../features/task/task-reschedule";
import { taskReschedulePostHandler } from "./reschedule-handler";

const input = { date: "2026-09-21", taskId: "10000000-0000-4000-8000-000000000001", targetDate: "2026-09-22" };
const output: TaskRescheduleResponse = { data: { ...input, dailyPlanId: "plan", itemId: "item", resultStatus: "rescheduled", changed: true }, effects: ["task_rescheduled"] };
const context = { supabase: {} } as AuthenticatedRequestContext;
const request = (body: unknown, token = "session") => new Request("http://localhost/api/commands/task/reschedule", {
  method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
});
describe("Task reschedule route", () => {
  it("authenticates and passes only validated action context", async () => {
    const command = vi.fn(async () => output);
    const authenticate = vi.fn(async () => context);
    const response = await taskReschedulePostHandler({ authenticate, command })(request(input));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(output);
    expect(authenticate).toHaveBeenCalledWith("session"); expect(command).toHaveBeenCalledWith(context, input);
  });
  it("rejects missing/invalid auth before command", async () => {
    const authenticate = vi.fn(async () => null), command = vi.fn(async () => output);
    const handler = taskReschedulePostHandler({ authenticate, command });
    expect((await handler(request(input, ""))).status).toBe(401); expect(authenticate).not.toHaveBeenCalled();
    expect((await handler(request(input))).status).toBe(401); expect(command).not.toHaveBeenCalled();
  });
  it.each([{}, { ...input, targetDate: input.date }, { ...input, targetDate: "2026-02-30" }, { ...input, userId: input.taskId },
    { ...input, isQualified: true }, { ...input, resultStatus: "rescheduled" }, { ...input, amount: 1 }])("rejects invalid inputs before authentication %#", async (body) => {
    const authenticate = vi.fn(async () => context);
    expect((await taskReschedulePostHandler({ authenticate, command: async () => output })(request(body))).status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it.each<[TaskRescheduleErrorCode, number]>([
    ["AUTHENTICATION_REQUIRED", 401], ["DAILY_PLAN_NOT_FOUND", 404], ["TASK_NOT_FOUND", 404], ["DAILY_ITEM_NOT_FOUND", 404],
    ["INVALID_RESCHEDULE_DATE", 400], ["DAILY_PLAN_NOT_COMMITTED", 409], ["TASK_RESCHEDULE_NOT_ALLOWED", 409],
    ["DAILY_ITEM_RESCHEDULE_NOT_ALLOWED", 409], ["TASK_ALREADY_RESCHEDULED", 409], ["RESCHEDULE_TARGET_CONFLICT", 409],
    ["RESCHEDULE_PLANNING_CONFLICT", 409], ["INVALID_USER_TIMEZONE", 409],
  ])("maps %s to HTTP %s", async (code, status) => {
    const handler = taskReschedulePostHandler({ authenticate: async () => context,
      command: async () => { throw new TaskRescheduleCommandError(code); } });
    const response = await handler(request(input));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: code });
  });
  it("rejects malformed JSON and hides unexpected database failures", async () => {
    expect((await taskReschedulePostHandler()(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
    const response = await taskReschedulePostHandler({ authenticate: async () => context, command: async () => { throw new Error("private SQL"); } })(request(input));
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

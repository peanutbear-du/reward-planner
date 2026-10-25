import type { TaskExecutionErrorCode, TaskExecutionResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequestContext } from "../../../../auth/authenticated-request";
import { TaskExecutionCommandError } from "../../../../features/task/task-execution";
import { taskExecutionPostHandler } from "./execution-handler";

const input = { taskId: "10000000-0000-4000-8000-000000000001", date: "2026-10-25" };
const context = { supabase: {} } as AuthenticatedRequestContext;
const output: TaskExecutionResponse = {
  data: { date: input.date, changed: true, task: { id: input.taskId, status: "completed", completedAt: "2026-10-25T01:00:00Z", updatedAt: "2026-10-25T01:00:00Z" },
    item: { id: "item", taskId: input.taskId, resultStatus: "completed", completedAtOnDay: "2026-10-25T01:00:00Z" } },
  effects: ["task_completed"],
};
const request = (body: unknown, token?: string) => new Request("http://localhost:3001/api/commands/task/complete", {
  method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
});
describe("Task execution route", () => {
  it.each([true, false])("passes the endpoint action and authenticated context (completed=%s)", async (completed) => {
    const command = vi.fn(async () => output);
    const handler = taskExecutionPostHandler(completed, { authenticate: async () => context, command });
    const response = await handler(request(input, "session-token"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(output);
    expect(command).toHaveBeenCalledWith(context, input, completed);
  });
  it("requires a valid Bearer session", async () => {
    const command = vi.fn(async () => output);
    const authenticate = vi.fn(async () => null);
    const handler = taskExecutionPostHandler(true, { command, authenticate });
    expect((await handler(request(input))).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    expect((await handler(request(input, "invalid"))).status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });
  it.each([{}, { ...input, taskId: "invalid" }, { ...input, date: "2026-02-30" },
    { ...input, userId: input.taskId }, { ...input, completed: true }, { ...input, isQualified: true }])("rejects invalid input %#", async (body) => {
    const authenticate = vi.fn(async () => context);
    const handler = taskExecutionPostHandler(true, { authenticate, command: async () => output });
    expect((await handler(request(body, "session-token"))).status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await taskExecutionPostHandler(false)(new Request("http://localhost/test", { method: "POST", body: "{" }))).status).toBe(400);
  });
  it.each<[TaskExecutionErrorCode, number]>([
    ["AUTHENTICATION_REQUIRED", 401], ["TASK_NOT_FOUND", 404], ["DAILY_PLAN_NOT_FOUND", 404], ["DAILY_ITEM_NOT_FOUND", 404],
    ["DAILY_PLAN_NOT_COMMITTED", 409], ["TASK_DATE_NOT_CURRENT", 409], ["DAILY_ITEM_EXECUTION_NOT_ALLOWED", 409], ["INVALID_USER_TIMEZONE", 409],
  ])("maps %s to HTTP %s", async (code, status) => {
    const handler = taskExecutionPostHandler(true, { authenticate: async () => context, command: async () => { throw new TaskExecutionCommandError(code); } });
    const response = await handler(request(input, "session-token"));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: code });
  });
  it("hides unexpected database errors", async () => {
    const handler = taskExecutionPostHandler(true, { authenticate: async () => context, command: async () => { throw new Error("private SQL detail"); } });
    const response = await handler(request(input, "session-token"));
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

import type { DeleteTaskResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { TaskCommandError } from "../../../../../features/task/task-command-error";
import { deleteTaskPostHandler } from "./handler";

const taskId = "10000000-0000-4000-8000-000000000001";
const responseBody: DeleteTaskResponse = {
  data: { taskId },
  effects: ["task_deleted"],
};
const authenticatedContext = { supabase: {} } as AuthenticatedRequestContext;

describe("POST /api/commands/task/delete", () => {
  it("returns 401 when authentication is missing or invalid", async () => {
    const authenticate = vi.fn(async () => null);
    const command = vi.fn(async () => responseBody);
    const handler = deleteTaskPostHandler({ authenticate, command });

    expect((await handler(request({ taskId }))).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();

    expect((await handler(request({ taskId }, "invalid-token"))).status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { taskId: "not-a-uuid" },
    { taskId, userId: taskId },
    { taskId, schedule: null },
  ])("returns 400 for invalid request %#", async (body) => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = deleteTaskPostHandler({ authenticate, command });

    const response = await handler(request(body, "valid-token"));

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("returns 200 and passes only the Task identity", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = deleteTaskPostHandler({ authenticate, command });

    const response = await handler(request({ taskId }, "valid-token"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(responseBody);
    expect(command).toHaveBeenCalledWith(authenticatedContext, { taskId });
  });

  it.each([
    [new TaskCommandError("not_found"), 404, "TASK_NOT_FOUND"],
    [new TaskCommandError("conflict"), 409, "TASK_DELETE_NOT_ALLOWED"],
  ] as const)("maps domain failures to %s", async (error, status, publicError) => {
    const handler = deleteTaskPostHandler({
      authenticate: async () => authenticatedContext,
      command: async () => {
        throw error;
      },
    });

    const response = await handler(request({ taskId }, "valid-token"));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: publicError });
  });

  it("returns a generic 500 for unexpected failures", async () => {
    const handler = deleteTaskPostHandler({
      authenticate: async () => authenticatedContext,
      command: async () => {
        throw new Error("sensitive SQL detail");
      },
    });

    const response = await handler(request({ taskId }, "valid-token"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "INTERNAL_SERVER_ERROR",
    });
  });
});

function request(body: unknown, accessToken?: string) {
  return new Request("http://localhost:3001/api/commands/task/delete", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    method: "POST",
  });
}

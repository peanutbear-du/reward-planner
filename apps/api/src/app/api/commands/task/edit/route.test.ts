import type { EditTaskTitleResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { TaskCommandError } from "../../../../../features/task/task-command-error";
import { editTaskTitlePostHandler } from "./handler";

const taskId = "10000000-0000-4000-8000-000000000001";
const responseBody: EditTaskTitleResponse = {
  data: {
    task: {
      id: taskId,
      title: "Updated title",
      status: "open",
      completedAt: null,
      createdAt: "2026-09-30T01:00:00Z",
      updatedAt: "2026-09-30T02:00:00Z",
    },
  },
  effects: ["task_updated"],
};
const authenticatedContext = { supabase: {} } as AuthenticatedRequestContext;

describe("POST /api/commands/task/edit", () => {
  it("returns 401 when authentication is missing or invalid", async () => {
    const authenticate = vi.fn(async () => null);
    const command = vi.fn(async () => responseBody);
    const handler = editTaskTitlePostHandler({ authenticate, command });

    expect((await handler(request({ taskId, title: "Title" }))).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();

    expect(
      (await handler(request({ taskId, title: "Title" }, "invalid-token"))).status,
    ).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { taskId: "not-a-uuid", title: "Title" },
    { taskId, title: "" },
    { taskId, title: "   " },
    { taskId, title: "Title", userId: taskId },
    { taskId, title: "Title", status: "completed" },
    { taskId, title: "Title", schedule: null },
  ])("returns 400 for invalid request %#", async (body) => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = editTaskTitlePostHandler({ authenticate, command });

    const response = await handler(request(body, "valid-token"));

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = editTaskTitlePostHandler({ authenticate, command });
    const response = await handler(
      new Request("http://localhost:3001/api/commands/task/edit", {
        body: "{",
        headers: { Authorization: "Bearer valid-token" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns 200 and passes a normalized command to the feature", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = editTaskTitlePostHandler({ authenticate, command });

    const response = await handler(
      request({ taskId, title: "  Updated title  " }, "valid-token"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(responseBody);
    expect(command).toHaveBeenCalledWith(authenticatedContext, {
      taskId,
      title: "Updated title",
    });
  });

  it.each([
    [new TaskCommandError("not_found"), 404, "TASK_NOT_FOUND"],
    [new TaskCommandError("conflict"), 409, "TASK_EDIT_NOT_ALLOWED"],
  ] as const)("maps domain failures to %s", async (error, status, publicError) => {
    const handler = editTaskTitlePostHandler({
      authenticate: async () => authenticatedContext,
      command: async () => {
        throw error;
      },
    });

    const response = await handler(
      request({ taskId, title: "Updated title" }, "valid-token"),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: publicError });
  });

  it("returns a generic 500 for unexpected failures", async () => {
    const handler = editTaskTitlePostHandler({
      authenticate: async () => authenticatedContext,
      command: async () => {
        throw new Error("sensitive SQL detail");
      },
    });

    const response = await handler(
      request({ taskId, title: "Updated title" }, "valid-token"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "INTERNAL_SERVER_ERROR",
    });
  });
});

function request(body: unknown, accessToken?: string) {
  return new Request("http://localhost:3001/api/commands/task/edit", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    method: "POST",
  });
}

import type { CreateTaskResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { createTaskPostHandler } from "./handler";

const responseBody: CreateTaskResponse = {
  data: {
    task: {
      id: "task-1",
      title: "Write report",
      status: "open",
      completedAt: null,
      createdAt: "2026-09-29T01:00:00Z",
      updatedAt: "2026-09-29T01:00:00Z",
    },
    planningItem: null,
  },
  effects: ["task_created"],
};

const authenticatedContext = {
  supabase: {},
} as AuthenticatedRequestContext;

describe("POST /api/commands/task/create", () => {
  it("returns 401 when the Bearer token is missing", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = createTaskPostHandler({ authenticate, command });

    const response = await handler(request({ title: "Task", schedule: null }));

    expect(response.status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("returns 401 when Supabase rejects the token", async () => {
    const authenticate = vi.fn(async () => null);
    const command = vi.fn(async () => responseBody);
    const handler = createTaskPostHandler({ authenticate, command });

    const response = await handler(
      request({ title: "Task", schedule: null }, "invalid-token"),
    );

    expect(response.status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { title: "", schedule: null },
    { title: "Task", schedule: null, userId: "another-user" },
    {
      title: "Task",
      schedule: {
        plannedDate: "2026-09-29",
        startTime: null,
        endTime: "10:00",
      },
    },
  ])("returns 400 for invalid request %#", async (body) => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = createTaskPostHandler({ authenticate, command });

    const response = await handler(request(body, "valid-token"));

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = createTaskPostHandler({ authenticate, command });
    const response = await handler(
      new Request("http://localhost:3001/api/commands/task/create", {
        body: "{",
        headers: { Authorization: "Bearer valid-token" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns 201 and passes a normalized command to the feature", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => responseBody);
    const handler = createTaskPostHandler({ authenticate, command });

    const response = await handler(
      request(
        {
          title: "  Write report  ",
          schedule: {
            plannedDate: "2026-09-29",
            startTime: "09:00",
            endTime: "10:00",
          },
        },
        "valid-token",
      ),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(responseBody);
    expect(command).toHaveBeenCalledWith(authenticatedContext, {
      title: "Write report",
      schedule: {
        plannedDate: "2026-09-29",
        startTime: "09:00",
        endTime: "10:00",
      },
    });
  });

  it("returns a non-sensitive 500 response for command failures", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const command = vi.fn(async () => {
      throw new Error("sensitive SQL detail");
    });
    const handler = createTaskPostHandler({ authenticate, command });

    const response = await handler(
      request({ title: "Task", schedule: null }, "valid-token"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "INTERNAL_SERVER_ERROR",
    });
  });
});

function request(body: unknown, accessToken?: string) {
  return new Request("http://localhost:3001/api/commands/task/create", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    method: "POST",
  });
}

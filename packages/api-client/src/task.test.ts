import type { CreateTaskResponse } from "@reward-planner/types";
import { describe, expect, it } from "vitest";

import { CreateTaskApiClientError, createTask } from "./task";

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

describe("createTask", () => {
  it("posts the command with the authenticated Bearer token", async () => {
    const requests: Array<{ input: URL | RequestInfo; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      requests.push({ input, init });
      return Response.json(responseBody, { status: 201 });
    };
    const input = { title: "Write report", schedule: null };

    await expect(
      createTask({
        apiBaseUrl: "http://localhost:3001",
        accessToken: "test-access-token",
        input,
        fetchImplementation,
      }),
    ).resolves.toEqual(responseBody);

    expect(String(requests[0]?.input)).toBe(
      "http://localhost:3001/api/commands/task/create",
    );
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer test-access-token",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(input);
  });

  it("throws a status-only error for unsuccessful responses", async () => {
    const fetchImplementation: typeof fetch = async () =>
      Response.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500 });

    await expect(
      createTask({
        apiBaseUrl: "http://localhost:3001",
        accessToken: "sensitive-token",
        input: { title: "Task", schedule: null },
        fetchImplementation,
      }),
    ).rejects.toEqual(new CreateTaskApiClientError(500));
  });
});

import type {
  CreateTaskResponse,
  DeleteTaskResponse,
  EditTaskTitleResponse,
} from "@reward-planner/types";
import { describe, expect, it } from "vitest";

import {
  CreateTaskApiClientError,
  DeleteTaskApiClientError,
  EditTaskTitleApiClientError,
  createTask,
  deleteTask,
  editTaskTitle,
} from "./task";

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

describe("editTaskTitle", () => {
  it("posts the authenticated edit command", async () => {
    const edited: EditTaskTitleResponse = {
      data: {
        task: { ...responseBody.data.task, title: "Updated title" },
      },
      effects: ["task_updated"],
    };
    const requests: Array<{ input: URL | RequestInfo; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      requests.push({ input, init });
      return Response.json(edited);
    };
    const input = {
      taskId: "10000000-0000-4000-8000-000000000001",
      title: "Updated title",
    };

    await expect(
      editTaskTitle({
        apiBaseUrl: "http://localhost:3001",
        accessToken: "test-access-token",
        input,
        fetchImplementation,
      }),
    ).resolves.toEqual(edited);

    expect(String(requests[0]?.input)).toBe(
      "http://localhost:3001/api/commands/task/edit",
    );
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer test-access-token",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(input);
  });

  it("throws a status-only edit error", async () => {
    const fetchImplementation: typeof fetch = async () =>
      Response.json({ error: "TASK_NOT_FOUND" }, { status: 404 });

    await expect(
      editTaskTitle({
        apiBaseUrl: "http://localhost:3001",
        accessToken: "sensitive-token",
        input: {
          taskId: "10000000-0000-4000-8000-000000000001",
          title: "Updated title",
        },
        fetchImplementation,
      }),
    ).rejects.toEqual(new EditTaskTitleApiClientError(404));
  });
});

describe("deleteTask", () => {
  it("posts the authenticated delete command", async () => {
    const deleted: DeleteTaskResponse = {
      data: { taskId: "10000000-0000-4000-8000-000000000001" },
      effects: ["task_deleted"],
    };
    const requests: Array<{ input: URL | RequestInfo; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      requests.push({ input, init });
      return Response.json(deleted);
    };
    const input = { taskId: deleted.data.taskId };

    await expect(
      deleteTask({
        apiBaseUrl: "http://localhost:3001",
        accessToken: "test-access-token",
        input,
        fetchImplementation,
      }),
    ).resolves.toEqual(deleted);

    expect(String(requests[0]?.input)).toBe(
      "http://localhost:3001/api/commands/task/delete",
    );
    expect(requests[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(input);
  });

  it("throws a status-only delete error", async () => {
    const fetchImplementation: typeof fetch = async () =>
      Response.json({ error: "TASK_DELETE_NOT_ALLOWED" }, { status: 409 });

    await expect(
      deleteTask({
        apiBaseUrl: "http://localhost:3001",
        accessToken: "sensitive-token",
        input: { taskId: "10000000-0000-4000-8000-000000000001" },
        fetchImplementation,
      }),
    ).rejects.toEqual(new DeleteTaskApiClientError(409));
  });
});

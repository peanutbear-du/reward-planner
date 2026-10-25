import { describe, expect, it, vi } from "vitest";
import { completeTask, uncompleteTask, TaskExecutionApiClientError } from "./task-execution";

describe("Task execution API client", () => {
  it.each([["complete", completeTask], ["uncomplete", uncompleteTask]] as const)("sends %s with Bearer Token and context only", async (action, command) => {
    const input = { taskId: "10000000-0000-4000-8000-000000000001", date: "2026-10-25" };
    const body = { data: {}, effects: [] };
    const controller = new AbortController();
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json(body));
    await expect(command({ apiBaseUrl: "http://localhost:3001", accessToken: "session-token", input, signal: controller.signal, fetchImplementation })).resolves.toEqual(body);
    const [url, options] = fetchImplementation.mock.calls[0];
    expect(String(url)).toBe(`http://localhost:3001/api/commands/task/${action}`);
    expect(options).toMatchObject({ method: "POST", cache: "no-store", signal: controller.signal });
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer session-token");
    expect(JSON.parse(options!.body as string)).toEqual(input);
  });
  it.each([true, false])("keeps the status when an error response has JSON: %s", async (json) => {
    await expect(completeTask({
      apiBaseUrl: "http://localhost:3001", accessToken: "session-token", input: { taskId: "task", date: "2026-10-25" },
      fetchImplementation: async () => json ? Response.json({ error: "TASK_DATE_NOT_CURRENT" }, { status: 409 }) : new Response("Unavailable", { status: 503 }),
    })).rejects.toEqual(new TaskExecutionApiClientError(json ? 409 : 503, json ? "TASK_DATE_NOT_CURRENT" : null));
  });
});

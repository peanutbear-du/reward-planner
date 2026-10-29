import { describe, expect, it, vi } from "vitest";
import { rescheduleTask, TaskRescheduleApiClientError } from "./task-reschedule";

const input = { date: "2026-09-21", taskId: "10000000-0000-4000-8000-000000000001", targetDate: "2026-09-22" };
describe("Task reschedule API client", () => {
  it("sends one authenticated command with an abort signal and no consequence fields", async () => {
    const body = { data: {}, effects: ["task_rescheduled"] };
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json(body));
    const controller = new AbortController();
    expect(await rescheduleTask({ apiBaseUrl: "http://localhost:3001", accessToken: "session", input, signal: controller.signal, fetchImplementation })).toEqual(body);
    const [url, options] = fetchImplementation.mock.calls[0];
    expect(String(url)).toBe("http://localhost:3001/api/commands/task/reschedule");
    expect(options).toMatchObject({ method: "POST", cache: "no-store", signal: controller.signal });
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer session");
    expect(JSON.parse(options!.body as string)).toEqual(input);
  });
  it.each([true, false])("preserves status and safe error code (JSON=%s)", async (json) => {
    await expect(rescheduleTask({ apiBaseUrl: "http://localhost:3001", accessToken: "session", input,
      fetchImplementation: async () => json ? Response.json({ error: "RESCHEDULE_TARGET_CONFLICT" }, { status: 409 }) : new Response("unavailable", { status: 503 }),
    })).rejects.toEqual(new TaskRescheduleApiClientError(json ? 409 : 503, json ? "RESCHEDULE_TARGET_CONFLICT" : null));
  });
});

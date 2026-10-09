import type { AddLaterResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import { addLater, AddLaterApiClientError } from "./add-later";

const taskId = "10000000-0000-4000-8000-000000000001";
const responseBody: AddLaterResponse = {
  data: { dailyPlanId: "plan", item: {
    id: "item", taskId, origin: "added_later", priority: "plan", resultStatus: "pending",
    title: "Frozen title", plannedStartTime: null, plannedEndTime: null,
    completedAtOnDay: null, rescheduledToDate: null,
  } },
  effects: ["daily_item_added_later"],
};

describe("addLater API client", () => {
  it("posts the explicit priority with Bearer auth and returns the frozen item", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json(responseBody));
    const input = { date: "2026-10-10", taskId, priority: "plan" as const };
    expect(await addLater({ apiBaseUrl: "http://localhost:3001", accessToken: "test-token", input, fetchImplementation }))
      .toEqual(responseBody);
    const [url, init] = fetchImplementation.mock.calls[0];
    expect(String(url)).toBe("http://localhost:3001/api/commands/today/add-later");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("exposes only the error status", async () => {
    await expect(addLater({
      apiBaseUrl: "http://localhost:3001", accessToken: "test-token",
      input: { date: "2026-10-10", taskId, priority: "plan" },
      fetchImplementation: async () => Response.json({ error: "INITIAL_ITEM_ALREADY_EXISTS" }, { status: 409 }),
    })).rejects.toEqual(new AddLaterApiClientError(409));
  });
});

import type { TodayResponse } from "@reward-planner/types";
import { describe, expect, it } from "vitest";

import { ApiClientError, getToday } from "./today";

const responseBody: TodayResponse = {
  date: "2026-09-29",
  timezone: null,
  dailyPlan: null,
  items: { mustDo: [], plan: [], addedLater: [] },
  schedule: { timedTasks: [], calendarEvents: [] },
  dailyStatus: { available: false },
  activeProjects: { available: false, items: [] },
};

describe("getToday", () => {
  it("sends the date and authenticated bearer token", async () => {
    const requests: Array<{ input: URL | RequestInfo; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      requests.push({ input, init });
      return Response.json(responseBody);
    };

    await expect(
      getToday({
        apiBaseUrl: "http://localhost:3001",
        accessToken: "test-access-token",
        date: "2026-09-29",
        fetchImplementation,
      }),
    ).resolves.toEqual(responseBody);

    expect(String(requests[0]?.input)).toBe(
      "http://localhost:3001/api/today?date=2026-09-29",
    );
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer test-access-token",
    );
  });

  it("throws a status-only error for unsuccessful responses", async () => {
    const fetchImplementation: typeof fetch = async () =>
      Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

    await expect(
      getToday({
        apiBaseUrl: "http://localhost:3001",
        accessToken: "sensitive-token",
        date: "2026-09-29",
        fetchImplementation,
      }),
    ).rejects.toEqual(new ApiClientError(401));
  });
});

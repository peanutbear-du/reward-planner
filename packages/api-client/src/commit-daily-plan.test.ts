import type { CommitDailyPlanResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import { commitDailyPlan, CommitDailyPlanApiClientError } from "./commit-daily-plan";

const responseBody: CommitDailyPlanResponse = {
  data: { date: "2026-10-09", dailyPlan: { id: "plan", status: "committed", snapshotCreatedAt: "2026-10-09T01:00:00Z" } },
  effects: ["daily_plan_committed"],
};

describe("commitDailyPlan API client", () => {
  it("posts the date with Bearer auth and returns the confirmed state", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json(responseBody));
    expect(await commitDailyPlan({
      apiBaseUrl: "http://localhost:3001", accessToken: "test-token",
      input: { date: "2026-10-09" }, fetchImplementation,
    })).toEqual(responseBody);
    const [url, init] = fetchImplementation.mock.calls[0];
    expect(String(url)).toBe("http://localhost:3001/api/commands/today/commit");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
    expect(JSON.parse(String(init?.body))).toEqual({ date: "2026-10-09" });
  });

  it("exposes a status-only business error", async () => {
    await expect(commitDailyPlan({
      apiBaseUrl: "http://localhost:3001", accessToken: "test-token",
      input: { date: "2026-10-09" },
      fetchImplementation: async () => Response.json({ error: "DAILY_PLAN_EMPTY" }, { status: 409 }),
    })).rejects.toEqual(new CommitDailyPlanApiClientError(409));
  });
});

import { describe, expect, it } from "vitest";

import { commitDailyPlanRequestSchema } from "./commit-daily-plan";

describe("commitDailyPlanRequestSchema", () => {
  it("accepts only a valid date", () => {
    expect(commitDailyPlanRequestSchema.parse({ date: "2026-10-09" })).toEqual({ date: "2026-10-09" });
  });

  it.each([
    {}, { date: "2026-02-29" }, { date: "2026-13-01" }, { date: "10/09/2026" },
    { date: "2026-10-09", userId: "another-user" },
    { date: "2026-10-09", status: "committed" },
    { date: "2026-10-09", snapshotCreatedAt: "client-timestamp" },
    { date: "2026-10-09", isQualified: true },
  ])("rejects invalid or injected input %#", (input) => {
    expect(commitDailyPlanRequestSchema.safeParse(input).success).toBe(false);
  });
});

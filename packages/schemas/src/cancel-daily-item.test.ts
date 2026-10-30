import { describe, expect, it } from "vitest";
import { cancelDailyItemRequestSchema } from "./cancel-daily-item";

const valid = { date: "2026-10-30", itemId: "60000000-0000-4000-8000-000000000001" };
describe("Cancel Daily Item request", () => {
  it.each(["2026-09-21", "2026-10-30", "2030-01-01"])("accepts date %s without a client Today restriction", (date) => {
    expect(cancelDailyItemRequestSchema.parse({ ...valid, date })).toEqual({ ...valid, date });
  });
  it.each([
    {}, { ...valid, itemId: "bad-id" }, { ...valid, date: "2026-02-30" }, { ...valid, date: "infinity" },
    { ...valid, date: "0000-01-01" }, { ...valid, date: "2026-10-30T00:00:00Z" },
    ...["userId", "taskId", "dailyPlanId", "resultStatus", "isQualified", "amount", "plannedDate"].map((key) => ({ ...valid, [key]: "forged" })),
  ])("rejects invalid identity/date or client consequences %#", (input) => {
    expect(cancelDailyItemRequestSchema.safeParse(input).success).toBe(false);
  });
});

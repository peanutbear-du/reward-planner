import { describe, expect, it } from "vitest";
import { taskRescheduleRequestSchema } from "./task-reschedule";

const valid = { date: "2026-09-21", taskId: "10000000-0000-4000-8000-000000000001", targetDate: "2026-09-22" };
describe("Task reschedule request", () => {
  it("accepts source identity and a later real calendar date", () => {
    expect(taskRescheduleRequestSchema.parse(valid)).toEqual(valid);
  });
  it.each([
    {}, { ...valid, taskId: "bad" }, { ...valid, date: "2026-02-30" }, { ...valid, targetDate: "2026-02-30" },
    { ...valid, targetDate: valid.date }, { ...valid, targetDate: "2026-09-20" },
    { ...valid, targetDate: "2026-09-22T00:00:00Z" }, { ...valid, targetDate: "infinity" },
    ...["userId", "resultStatus", "isQualified", "amount", "completedAt", "origin", "priority"].map((key) => ({ ...valid, [key]: "forged" })),
  ])("rejects invalid dates or client-written consequences %#", (input) => {
    expect(taskRescheduleRequestSchema.safeParse(input).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { taskExecutionRequestSchema } from "./task-execution";

const valid = { taskId: "10000000-0000-4000-8000-000000000001", date: "2026-10-25" };
describe("Task execution request", () => {
  it("accepts only a Task identity and calendar date", () => {
    expect(taskExecutionRequestSchema.parse(valid)).toEqual(valid);
  });
  it.each([
    {}, { ...valid, taskId: "not-a-uuid" }, { ...valid, date: "2026-02-30" },
    { ...valid, date: "2026-10-25T00:00:00Z" }, { ...valid, userId: valid.taskId },
    { ...valid, completed: true }, { ...valid, status: "completed" },
    { ...valid, completedAt: "2026-10-25T01:00:00Z" }, { ...valid, isQualified: true },
  ])("rejects invalid or client-controlled consequences %#", (input) => {
    expect(taskExecutionRequestSchema.safeParse(input).success).toBe(false);
  });
});

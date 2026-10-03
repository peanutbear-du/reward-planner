import { describe, expect, it } from "vitest";

import {
  createTaskRequestSchema,
  deleteTaskRequestSchema,
  editTaskTitleRequestSchema,
} from "./task";

describe("createTaskRequestSchema", () => {
  it("trims a valid title and accepts no schedule", () => {
    expect(
      createTaskRequestSchema.parse({ title: "  Write report  ", schedule: null }),
    ).toEqual({ title: "Write report", schedule: null });
  });

  it.each(["", "   "])("rejects an empty title %j", (title) => {
    expect(createTaskRequestSchema.safeParse({ title, schedule: null }).success).toBe(
      false,
    );
  });

  it("accepts date-only, start-only, and bounded schedules", () => {
    for (const schedule of [
      { plannedDate: "2026-09-29", startTime: null, endTime: null },
      { plannedDate: "2026-09-29", startTime: "09:00", endTime: null },
      { plannedDate: "2026-09-29", startTime: "09:00", endTime: "10:30" },
    ]) {
      expect(
        createTaskRequestSchema.safeParse({ title: "Task", schedule }).success,
      ).toBe(true);
    }
  });

  it.each([
    { plannedDate: "2026-02-29", startTime: null, endTime: null },
    { plannedDate: "2026-09-29", startTime: "9:00", endTime: null },
    { plannedDate: "2026-09-29", startTime: "24:00", endTime: null },
    { plannedDate: "2026-09-29", startTime: null, endTime: "10:00" },
    { plannedDate: "2026-09-29", startTime: "10:00", endTime: "10:00" },
    { plannedDate: "2026-09-29", startTime: "10:00", endTime: "09:59" },
  ])("rejects invalid schedule %#", (schedule) => {
    expect(
      createTaskRequestSchema.safeParse({ title: "Task", schedule }).success,
    ).toBe(false);
  });

  it("rejects missing or unknown request fields", () => {
    expect(createTaskRequestSchema.safeParse({ title: "Task" }).success).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        title: "Task",
        schedule: null,
        userId: "other-user",
      }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        title: "Task",
        schedule: {
          plannedDate: "2026-09-29",
          startTime: null,
          endTime: null,
          priority: "must_do",
        },
      }).success,
    ).toBe(false);
  });
});

describe("editTaskTitleRequestSchema", () => {
  const taskId = "10000000-0000-4000-8000-000000000001";

  it("accepts a UUID and trims the title", () => {
    expect(
      editTaskTitleRequestSchema.parse({ taskId, title: "  Updated title  " }),
    ).toEqual({ taskId, title: "Updated title" });
  });

  it.each([
    { taskId: "not-a-uuid", title: "Updated title" },
    { taskId, title: "" },
    { taskId, title: "   " },
    { taskId, title: "Updated title", userId: taskId },
    { taskId, title: "Updated title", status: "completed" },
    { taskId, title: "Updated title", schedule: null },
  ])("rejects invalid or injected input %#", (input) => {
    expect(editTaskTitleRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe("deleteTaskRequestSchema", () => {
  const taskId = "10000000-0000-4000-8000-000000000001";

  it("accepts only a Task UUID", () => {
    expect(deleteTaskRequestSchema.parse({ taskId })).toEqual({ taskId });
  });

  it.each([
    { taskId: "not-a-uuid" },
    { taskId, userId: taskId },
    { taskId, schedule: null },
  ])("rejects invalid or injected input %#", (input) => {
    expect(deleteTaskRequestSchema.safeParse(input).success).toBe(false);
  });
});

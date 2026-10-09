import { describe, expect, it } from "vitest";

import {
  upsertDraftTodayItemRequestSchema,
  removeDraftTodayItemRequestSchema,
} from "./draft-today";

const identity = { date: "2026-10-03", taskId: "10000000-0000-4000-8000-000000000001" };

describe("Draft Today request schemas", () => {
  it.each(["must_do", "plan"])("accepts %s and a valid removal", (priority) => {
    expect(upsertDraftTodayItemRequestSchema.parse({ ...identity, priority })).toEqual({
      ...identity, priority,
    });
    expect(removeDraftTodayItemRequestSchema.parse(identity)).toEqual(identity);
  });

  it.each([
    { ...identity, date: "2026-02-29" },
    { ...identity, taskId: "bad-id" },
    { ...identity, userId: identity.taskId },
    { ...identity, schedule: null },
    { ...identity, origin: "added_later" },
    { ...identity, isQualified: true },
  ])("rejects invalid or injected fields %#", (input) => {
    expect(upsertDraftTodayItemRequestSchema.safeParse({ ...input, priority: "plan" }).success).toBe(false);
    expect(removeDraftTodayItemRequestSchema.safeParse(input).success).toBe(false);
  });

  it.each([undefined, "urgent", "added_later"])("rejects priority %s", (priority) => {
    expect(upsertDraftTodayItemRequestSchema.safeParse({ ...identity, priority }).success).toBe(false);
  });
});

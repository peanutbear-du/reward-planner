import { describe, expect, it } from "vitest";

import { addLaterRequestSchema } from "./add-later";

const identity = { date: "2026-10-10", taskId: "10000000-0000-4000-8000-000000000001" };

describe("addLaterRequestSchema", () => {
  it.each(["must_do", "plan"])("accepts an explicit %s priority", (priority) => {
    expect(addLaterRequestSchema.parse({ ...identity, priority })).toEqual({ ...identity, priority });
  });

  it.each([
    identity, { ...identity, priority: "urgent" },
    { ...identity, date: "2026-02-29", priority: "plan" },
    { ...identity, taskId: "invalid", priority: "plan" },
    { ...identity, priority: "plan", userId: identity.taskId },
    { ...identity, priority: "plan", origin: "initial" },
    { ...identity, priority: "plan", resultStatus: "completed" },
    { ...identity, priority: "plan", titleSnapshot: "Client title" },
    { ...identity, priority: "plan", schedule: null },
    { ...identity, priority: "plan", isQualified: true },
  ])("rejects missing/invalid fields or client-controlled domain state %#", (input) => {
    expect(addLaterRequestSchema.safeParse(input).success).toBe(false);
  });
});

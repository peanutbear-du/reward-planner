import { describe, expect, it } from "vitest";

import { todayQuerySchema } from "./today";

describe("todayQuerySchema", () => {
  it("accepts a valid YYYY-MM-DD calendar date", () => {
    expect(todayQuerySchema.parse({ date: "2028-02-29" })).toEqual({
      date: "2028-02-29",
    });
  });

  it.each(["2026-9-29", "2026-02-29", "2026-04-31", "not-a-date"])(
    "rejects invalid date %s",
    (date) => {
      expect(todayQuerySchema.safeParse({ date }).success).toBe(false);
    },
  );

  it("rejects a missing date and unknown query fields", () => {
    expect(todayQuerySchema.safeParse({}).success).toBe(false);
    expect(
      todayQuerySchema.safeParse({ date: "2026-09-29", user_id: "other" })
        .success,
    ).toBe(false);
  });
});

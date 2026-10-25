import { describe, expect, it } from "vitest";
import { localDate, shiftDate } from "./date";

describe("local calendar dates", () => {
  it("uses browser calendar fields, even when UTC is on the previous day", () => {
    const date = new Date("2026-10-21T16:30:00Z");
    // Simulate the local fields of Asia/Shanghai without depending on test host TZ.
    date.getFullYear = () => 2026;
    date.getMonth = () => 9;
    date.getDate = () => 22;
    expect(localDate(date)).toBe("2026-10-22");
  });
  it("navigates across month and year boundaries", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftDate("0001-01-01", 1)).toBe("0001-01-02");
  });
});

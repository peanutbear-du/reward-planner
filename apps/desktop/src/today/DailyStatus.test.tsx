// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DailyStatus } from "./DailyStatus";

afterEach(cleanup);

describe("persisted Daily Status presentation", () => {
  it("labels a historical selection without changing its stored qualification", () => {
    render(<DailyStatus isToday={false} failed={false} status={{ available: true, totalItems: 5,
      completedItems: 4, completionRate: 80, mustDoItems: 0, completedMustDoItems: 0,
      isQualified: true, qualifiedAt: "2026-10-26T00:00:00Z", calculatedAt: "2026-10-26T00:00:00Z" }} />);
    expect(screen.getByRole("heading", { name: "当日状态" })).toBeTruthy();
    expect(screen.getByText("当日已达标")).toBeTruthy();
  });
  it.each([
    [{ available: false, reason: "no_plan" } as const, "尚无每日计划。"],
    [{ available: false, reason: "draft" } as const, "确认计划后显示完成情况。"],
  ])("keeps unavailable states distinct", (status, copy) => {
    render(<DailyStatus status={status} failed={false} />);
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it.each([true, false])("uses the server's qualified flag without inferring it from a percentage: %s", (isQualified) => {
    render(<DailyStatus failed={false} status={{ available: true, totalItems: 5,
      completedItems: 4, completionRate: 80, mustDoItems: 1, completedMustDoItems: isQualified ? 1 : 0,
      isQualified, qualifiedAt: isQualified ? "2026-10-26T00:00:00Z" : null,
      calculatedAt: "2026-10-26T00:00:00Z" }} />);
    expect(screen.getByText("4 / 5")).toBeTruthy();
    expect(screen.getByText(isQualified ? "今日已达标" : "今日尚未达标")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("80");
    expect(screen.getByText("每日奖励尚未接入")).toBeTruthy();
    expect(screen.queryByText(/已计入|\+1/)).toBeNull();
  });
  it("handles N=0 without presenting a qualified day", () => {
    render(<DailyStatus failed={false} status={{ available: true, totalItems: 0,
      completedItems: 0, completionRate: 0, mustDoItems: 0, completedMustDoItems: 0,
      isQualified: false, qualifiedAt: null, calculatedAt: "2026-10-26T00:00:00Z" }} />);
    expect(screen.getByText("暂无可计入的任务")).toBeTruthy();
    expect(screen.getByText("0 / 0")).toBeTruthy();
  });
  it("hides stale status on a failed refresh", () => {
    render(<DailyStatus failed status={{ available: true, totalItems: 5,
      completedItems: 5, completionRate: 100, mustDoItems: 0, completedMustDoItems: 0,
      isQualified: true, qualifiedAt: "2026-10-26T00:00:00Z", calculatedAt: "2026-10-26T00:00:00Z" }} />);
    expect(screen.getByText("每日状态加载失败，请刷新。")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

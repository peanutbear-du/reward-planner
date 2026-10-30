// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyPlanItemResultStatus, TodayResponse } from "@reward-planner/types";
import { TodayPage } from "./TodayPage";
import { localDate, shiftDate } from "./date";

const itemId = "60000000-0000-4000-8000-000000000001", taskId = "10000000-0000-4000-8000-000000000001";
const title = "保留历史的条目";
let days: Map<string, TodayResponse>;
let rejected: string | null;
let loseResponse: boolean;
let pause: Promise<void> | null;
let requests: { path: string; input: Record<string, unknown> }[];

function fixture(date: string, status: "committed" | "draft" = "committed", resultStatus: DailyPlanItemResultStatus = "pending"): TodayResponse {
  return { date, timezone: "Pacific/Kiritimati", execution: { currentDate: shiftDate(localDate(), 1), available: false },
    dailyPlan: { id: "plan", status, snapshotCreatedAt: status === "committed" ? "2026-10-30T00:00:00Z" : null },
    items: { mustDo: [], addedLater: [], plan: [{ id: itemId, taskId, title, origin: "initial", priority: "plan", resultStatus,
      plannedStartTime: "09:00:00", plannedEndTime: "10:00:00", completedAtOnDay: null, rescheduledToDate: null, canReschedule: false }] },
    schedule: { timedTasks: [{ planningItemId: "planning", dailyPlanItemId: itemId, taskId, title, startTime: "09:00:00", endTime: "10:00:00", countsTowardDaily: true }], calendarEvents: [] },
    dailyStatus: status === "committed" ? { available: true, totalItems: 5, completedItems: 4, completionRate: 80,
      mustDoItems: 0, completedMustDoItems: 0, isQualified: true, qualifiedAt: "2026-10-30T01:00:00Z", calculatedAt: "2026-10-30T01:00:00Z" }
      : { available: false, reason: "draft" }, activeProjects: { available: false, items: [] } };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  days = new Map([[localDate(), fixture(localDate())]]); rejected = null; loseResponse = false; pause = null; requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: URL, options: RequestInit) => {
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer cancel-session");
    if (url.pathname === "/api/today") return Response.json(days.get(url.searchParams.get("date")!)!);
    const input = JSON.parse(options.body as string);
    requests.push({ path: url.pathname, input });
    expect(url.pathname).toBe("/api/commands/daily-item/cancel");
    expect(input).toEqual({ date: input.date, itemId });
    if (pause) await pause;
    if (rejected) return Response.json({ error: rejected }, { status: rejected === "UNAVAILABLE" ? 503 : 409 });
    const data = days.get(input.date)!, item = [...data.items.plan, ...data.items.addedLater][0];
    const changed = item.resultStatus !== "cancelled";
    item.resultStatus = "cancelled"; data.schedule.timedTasks = [];
    if (loseResponse) { loseResponse = false; return new Response("reply lost", { status: 503 }); }
    return Response.json({ data: { ...input, dailyPlanId: "plan", resultStatus: "cancelled", changed }, effects: changed ? ["daily_item_cancelled"] : [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function ready(date = localDate()) {
  await screen.findAllByText(title, { exact: true });
  if (date !== localDate()) fireEvent.change(screen.getByLabelText("选择日期"), { target: { value: date } });
  await waitFor(() => expect((screen.getByRole("button", { name: `取消条目：${title}` }) as HTMLButtonElement).disabled).toBe(false));
}
async function openConfirm() {
  fireEvent.click(screen.getByRole("button", { name: `取消条目：${title}` }));
  return await screen.findByRole("dialog", { name: "取消此日期的条目？" });
}

describe("Today Daily Item cancellation", () => {
  it.each([-7, 0, 7])("confirms and persists a committed Item for date offset %s without requiring execution eligibility", async (offset) => {
    const date = shiftDate(localDate(), offset); days.set(date, fixture(date));
    const view = render(<TodayPage accessToken="cancel-session" />); await ready(date);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    const before = structuredClone(days.get(date)!.dailyStatus);
    const dialog = await openConfirm();
    expect(dialog.textContent).toContain(date); expect(dialog.textContent).toContain("不会取消全局任务"); expect(requests).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "确认取消" }));
    await screen.findByText("已取消此日期的条目，历史记录已保留。");
    await screen.findByText(/已取消 ·/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: `取消条目：${title}` })).toBeNull();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(days.get(date)!.items.plan[0]).toMatchObject({ id: itemId, taskId, title, plannedStartTime: "09:00:00", plannedEndTime: "10:00:00", resultStatus: "cancelled" });
    expect(days.get(date)!.dailyStatus).toEqual(before);
    expect(requests).toEqual([{ path: "/api/commands/daily-item/cancel", input: { date, itemId } }]);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "刷新" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/已取消 ·/)).toBeTruthy();
    view.unmount(); render(<TodayPage accessToken="cancel-session" />);
    await screen.findAllByText(title, { exact: true });
    if (date !== localDate()) fireEvent.change(screen.getByLabelText("选择日期"), { target: { value: date } });
    await screen.findByText(/已取消 ·/);
  });

  it("requires final confirmation; Back and Escape send no command", async () => {
    render(<TodayPage accessToken="cancel-session" />); await ready();
    await openConfirm(); fireEvent.click(screen.getByRole("button", { name: "保留条目" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = await openConfirm(); fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(requests).toHaveLength(0);
    expect(days.get(localDate())!.items.plan[0].resultStatus).toBe("pending");
  });

  it("disables duplicate submission and dismissal until the server responds, without optimistic cancellation", async () => {
    let release!: () => void; pause = new Promise<void>((resolve) => { release = resolve; });
    render(<TodayPage accessToken="cancel-session" />); await ready(); const dialog = await openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));
    await screen.findByText("正在取消…");
    expect((screen.getByRole("button", { name: "保留条目" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "正在取消…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true })); expect(screen.getByRole("dialog")).toBeTruthy();
    expect(days.get(localDate())!.items.plan[0].resultStatus).toBe("pending"); expect(requests).toHaveLength(1);
    release(); await screen.findByText(/已取消 ·/);
  });

  it("keeps an error in the dialog and retries identical Item/date context", async () => {
    rejected = "DAILY_ITEM_CANCEL_NOT_ALLOWED";
    render(<TodayPage accessToken="cancel-session" />); await ready(); await openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));
    await screen.findByText("只能取消待完成的条目；此条目已完成、改期或不再允许取消，请刷新。");
    expect(days.get(localDate())!.items.plan[0].resultStatus).toBe("pending");
    rejected = null; fireEvent.click(screen.getByRole("button", { name: "重试取消" }));
    await screen.findByText(/已取消 ·/); expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  });

  it("safely retries a lost success response and then refetches the recorded cancellation", async () => {
    loseResponse = true;
    render(<TodayPage accessToken="cancel-session" />); await ready(); await openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "确认取消" })); await screen.findByRole("alert");
    expect(screen.queryByText(/已取消 ·/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试取消" }));
    await screen.findByText(/已取消 ·/); expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  });

  it.each(["completed", "cancelled", "rescheduled", "incomplete"] as const)("does not offer cancellation for %s", async (state) => {
    days.set(localDate(), fixture(localDate(), "committed", state));
    render(<TodayPage accessToken="cancel-session" />); await screen.findAllByText(title, { exact: true });
    expect(screen.queryByRole("button", { name: `取消条目：${title}` })).toBeNull(); expect(requests).toHaveLength(0);
  });
  it("keeps Draft removal distinct from committed cancellation", async () => {
    days.set(localDate(), fixture(localDate(), "draft"));
    render(<TodayPage accessToken="cancel-session" />); await screen.findByText("计划草稿");
    fireEvent.click(screen.getByRole("button", { name: "编辑计划草稿" }));
    expect(screen.getByRole("button", { name: `移除${title}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `取消条目：${title}` })).toBeNull(); expect(requests).toHaveLength(0);
  });
  it("cancels Added Later by Item ID while retaining its origin and priority", async () => {
    const data = days.get(localDate())!, item = data.items.plan.pop()!;
    item.origin = "added_later"; item.priority = "must_do"; data.items.addedLater.push(item);
    render(<TodayPage accessToken="cancel-session" />); await ready(); await openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "确认取消" })); await screen.findByText(/已取消 ·/);
    expect(data.items.addedLater[0]).toMatchObject({ id: itemId, taskId, origin: "added_later", priority: "must_do", resultStatus: "cancelled" });
  });
});

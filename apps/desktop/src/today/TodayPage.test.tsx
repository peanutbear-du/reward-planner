// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TodayItem, TodayResponse } from "@reward-planner/types";

import { TodayPage } from "./TodayPage";
import { localDate, shiftDate } from "./date";

function empty(date: string): TodayResponse {
  return { date, timezone: null, dailyPlan: null,
    items: { mustDo: [], plan: [], addedLater: [] },
    schedule: { timedTasks: [], calendarEvents: [] },
    dailyStatus: { available: false }, activeProjects: { available: false, items: [] } };
}

let days: Map<string, TodayResponse>;
let titles: Map<string, string>;
let fetchMock: Mock<(url: URL, options: RequestInit) => Promise<Response>>;
let failNextPut: boolean;
let failReads: boolean;
let created: number;
const day = () => days.get(localDate())!;

beforeEach(() => {
  days = new Map([[localDate(), empty(localDate())]]);
  titles = new Map(); created = 0; failNextPut = false; failReads = false;
  fetchMock = vi.fn(async (url: URL, options: RequestInit) => {
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer browser-session");
    if (url.pathname === "/api/today") {
      if (failReads) return new Response(null, { status: 503 });
      const date = url.searchParams.get("date")!;
      return Response.json(days.get(date) ?? empty(date));
    }
    const input = JSON.parse(options.body as string);
    if (url.pathname === "/api/commands/task/create") {
      expect(input.schedule).toBeNull();
      const id = `task-${++created}`; titles.set(id, input.title);
      return Response.json({ data: { task: { id } }, effects: ["task_created"] });
    }
    const current = days.get(input.date) ?? empty(input.date);
    days.set(input.date, current);
    if (url.pathname.endsWith("/commit")) {
      current.dailyPlan = { id: "daily", status: "committed", snapshotCreatedAt: "2026-10-22T03:00:00Z" };
    } else if (url.pathname.endsWith("/remove-item")) {
      current.items.mustDo = current.items.mustDo.filter((item) => item.taskId !== input.taskId);
      current.items.plan = current.items.plan.filter((item) => item.taskId !== input.taskId);
    } else {
      if (failNextPut) { failNextPut = false; return new Response(null, { status: 503 }); }
      const added = url.pathname.endsWith("/add-later");
      current.dailyPlan ??= { id: "daily", status: "draft", snapshotCreatedAt: null };
      const item: TodayItem = { id: input.taskId, taskId: input.taskId, title: titles.get(input.taskId)!,
        origin: added ? "added_later" : "initial", priority: input.priority, resultStatus: "pending",
        plannedStartTime: null, plannedEndTime: null, completedAtOnDay: null, rescheduledToDate: null };
      if (added) current.items.addedLater.push(item);
      else {
        current.items.mustDo = current.items.mustDo.filter((old) => old.taskId !== input.taskId);
        current.items.plan = current.items.plan.filter((old) => old.taskId !== input.taskId);
        current.items[input.priority === "must_do" ? "mustDo" : "plan"].push(item);
      }
    }
    return Response.json({ data: {}, effects: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function ready() {
  await screen.findByText("计划草稿");
  await waitFor(() => expect((screen.getByRole("button", { name: "＋ 添加任务" }) as HTMLButtonElement).disabled).toBe(false));
}
function openCreate() {
  fireEvent.click(screen.getByRole("button", { name: "＋ 添加任务" }));
}
async function add(title: string, later = false) {
  openCreate();
  fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: later ? "创建并稍后新增" : "创建并加入草稿" }));
  await screen.findByText(title);
  await waitFor(() => expect(screen.queryByLabelText("任务名称")).toBeNull());
}

describe("Today Desktop", () => {
  it("keeps the add form collapsed by default and preserves input when toggled", async () => {
    render(<TodayPage accessToken="browser-session" />); await ready();
    expect(screen.queryByRole("form", { name: "新增任务" })).toBeNull();
    expect(screen.getByRole("button", { name: "＋ 添加任务" }).getAttribute("aria-expanded")).toBe("false");
    openCreate();
    expect(document.activeElement).toBe(screen.getByLabelText("任务名称"));
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "Unsubmitted draft" } });
    fireEvent.click(screen.getByRole("button", { name: "收起添加" }));
    expect(screen.queryByLabelText("任务名称")).toBeNull();
    expect(created).toBe(0);
    openCreate();
    expect((screen.getByLabelText("任务名称") as HTMLInputElement).value).toBe("Unsubmitted draft");
    await screen.findByText("编辑后确认初始计划");
  });

  it("shows loading and blocks duplicate writes and date changes while saving", async () => {
    render(<TodayPage accessToken="browser-session" />);
    expect(screen.getByText("正在加载每日计划…")).toBeTruthy();
    await ready();
    openCreate();
    const server = fetchMock.getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async (url: URL, options: RequestInit) => {
      if (url.pathname.endsWith("/create")) await pending;
      return server(url, options);
    });
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "Pending task" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并加入草稿" }));
    await screen.findByText("正在保存…");
    expect((screen.getByRole("button", { name: "创建并加入草稿" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "后一天" }) as HTMLButtonElement).disabled).toBe(true);
    release();
    await screen.findByText("Pending task");
    expect(created).toBe(1);
  });

  it("creates, changes priority, removes, commits, adds later and reloads server truth", async () => {
    const view = render(<TodayPage accessToken="browser-session" />); await ready();
    expect((screen.getByRole("button", { name: "完成今日计划" }) as HTMLButtonElement).disabled).toBe(true);
    await add("Prepare report");
    fireEvent.change(screen.getByLabelText("Prepare report的优先级"), { target: { value: "must_do" } });
    await waitFor(() => expect(within(screen.getByRole("region", { name: "必须完成" })).queryByText("Prepare report")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Prepare report的优先级"), { target: { value: "plan" } });
    await waitFor(() => expect(within(screen.getByRole("region", { name: "计划" })).queryByText("Prepare report")).not.toBeNull());
    await add("Remove me");
    fireEvent.click(screen.getByRole("button", { name: "移除Remove me" }));
    await waitFor(() => expect(screen.queryByText("Remove me")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "完成今日计划" }));
    await screen.findByText("计划已确认");
    expect(screen.queryByLabelText("Prepare report的优先级")).toBeNull();
    expect(screen.queryByRole("button", { name: "完成今日计划" })).toBeNull();
    await add("Read later", true);
    expect(within(screen.getByRole("region", { name: "稍后新增" })).getByText("Read later")).toBeTruthy();
    expect(day().items.plan[0].taskId).toBe("task-1");
    expect(created).toBe(3);
    view.unmount(); render(<TodayPage accessToken="browser-session" />);
    await screen.findByText("计划已确认"); await screen.findByText("Read later");
    expect(screen.getAllByText("尚未实现")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("retries a failed join using the existing Task", async () => {
    render(<TodayPage accessToken="browser-session" />); await ready(); failNextPut = true;
    openCreate();
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "Keep identity" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并加入草稿" }));
    await screen.findByRole("alert");
    expect(created).toBe(1);
    expect((screen.getByRole("button", { name: "收起添加" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "后一天" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重试加入此任务" }));
    await screen.findByText("Keep identity");
    expect(created).toBe(1); expect(day().items.plan).toHaveLength(1);
  });

  it("shows read errors, retries, validates empty titles and switches dates", async () => {
    failReads = true; render(<TodayPage accessToken="browser-session" />);
    await screen.findByRole("alert"); expect(screen.queryByLabelText("任务名称")).toBeNull();
    failReads = false; fireEvent.click(screen.getByRole("button", { name: "刷新" })); await ready();
    openCreate();
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "创建并加入草稿" }));
    await screen.findByText("请输入任务名称。"); expect(created).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "后一天" }));
    await waitFor(() => expect((screen.getByLabelText("选择日期") as HTMLInputElement).value).toBe(shiftDate(localDate(), 1)));
    expect(screen.queryByText("请输入任务名称。")).toBeNull();
    await ready(); fireEvent.click(screen.getByRole("button", { name: "今天" })); await ready();
  });

  it("renders schedule context and keeps failed refreshes from enabling stale edits", async () => {
    day().schedule.timedTasks.push({ planningItemId: "p", dailyPlanItemId: null, taskId: "t", title: "Scheduled task",
      startTime: "10:00:00", endTime: "11:00:00", countsTowardDaily: false });
    render(<TodayPage accessToken="browser-session" />); await ready();
    expect(screen.getByText("Scheduled task")).toBeTruthy();
    expect(screen.getByText(/未加入每日计划/)).toBeTruthy();
    openCreate();
    failReads = true; fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "创建并加入草稿" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps task markers inert instead of simulating completion", async () => {
    const view = render(<TodayPage accessToken="browser-session" />); await ready();
    await add("Read-only completion marker");
    const marker = view.container.querySelector(".task-marker")!;
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(marker);
    fireEvent.keyDown(marker, { key: " " });
    expect(marker.getAttribute("aria-hidden")).toBe("true");
    expect(marker.hasAttribute("tabindex")).toBe(false);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(fetchMock.mock.calls).toHaveLength(callsBefore);
    expect(day().items.plan[0].resultStatus).toBe("pending");
    expect(screen.getByText("待完成")).toBeTruthy();
  });
});

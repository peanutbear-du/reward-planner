// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getProjects } from "@reward-planner/api-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

const { session } = vi.hoisted(() => ({
  session: { user: { id: "a" }, access_token: "a-token" },
}));
vi.mock("../auth/use-auth-session", () => ({
  useAuthSession: () => ({ session, error: null, isLoading: false }),
}));
vi.mock("@reward-planner/api-client", () => ({ getProjects: vi.fn() }));

const read = vi.mocked(getProjects);
const project = {
  id: "a-project", title: "项目 A", status: "active" as const, scale: "major" as const,
  rewardPool: 24, deadline: "2026-12-01", nextMilestone: null, nextAction: null,
};

beforeAll(async () => {
  await import("./ProjectOverviewPage");
});

beforeEach(() => {
  read.mockReset();
  session.user.id = "a";
  session.access_token = "a-token";
  window.history.replaceState(null, "", "#projects");
});
afterEach(cleanup);

describe("Project Overview", () => {
  it("shows date-only fields, filter states, and the pending Activity Pulse", async () => {
    read.mockResolvedValueOnce({ projects: [project], nextCursor: null })
      .mockResolvedValueOnce({ projects: [], nextCursor: null })
      .mockResolvedValueOnce({ projects: [{ ...project, title: "完成项目", status: "completed", scale: "small", rewardPool: 4 }], nextCursor: null });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "项目 A" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "项目", current: "page" }).getAttribute("href")).toBe("#projects");
    expect(screen.getByText("重大 · +24")).toBeTruthy();
    expect(screen.getByText("2026年12月1日").getAttribute("datetime")).toBe("2026-12-01");
    expect(screen.getByText("暂无待完成里程碑")).toBeTruthy();
    expect(screen.getByText("未设置")).toBeTruthy();
    expect(screen.getByText("活动记录待接入")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "已暂停" }));
    expect(await screen.findByText("暂无已暂停的项目。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));
    expect(await screen.findByRole("heading", { name: "完成项目" })).toBeTruthy();
    expect(read.mock.calls.map(([options]) => options.status)).toEqual(["active", "paused", "completed"]);
  });

  it("retries failed requests and appends only the next cursor page", async () => {
    read.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ projects: [project], nextCursor: project.id })
      .mockResolvedValueOnce({ projects: [{ ...project, id: "p2", title: "第二页" }], nextCursor: null });
    render(<App />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "项目 A" });
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByRole("heading", { name: "第二页" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "项目 A" })).toHaveLength(1);
    expect(read.mock.lastCall?.[0].cursor).toBe(project.id);
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });

  it("removes old account rows and disregards a late response that ignores abort", async () => {
    let resolveOld!: (page: Awaited<ReturnType<typeof getProjects>>) => void;
    read.mockResolvedValueOnce({ projects: [project], nextCursor: project.id })
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ projects: [{ ...project, id: "b-project", title: "项目 B" }], nextCursor: null });
    const { rerender } = render(<App />);
    await screen.findByRole("heading", { name: "项目 A" });
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    const oldSignal = read.mock.lastCall?.[0].signal;
    session.user.id = "b";
    session.access_token = "b-token";
    rerender(<App />);
    expect(screen.queryByRole("heading", { name: "项目 A" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "项目 B" })).toBeTruthy();
    expect(oldSignal?.aborted).toBe(true);
    expect(read.mock.lastCall?.[0].accessToken).toBe("b-token");
    expect(read.mock.lastCall?.[0].cursor).toBeUndefined();
    await act(async () => resolveOld({ projects: [{ ...project, title: "迟到项目" }], nextCursor: null }));
    expect(screen.queryByRole("heading", { name: "迟到项目" })).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWish, getWishBoard, getWishCoverUrl, startWish, switchWish } from "@reward-planner/api-client";
import type { WishBoardResponse, WishBoardWish } from "@reward-planner/types";
import { WishBoardPage } from "./WishBoardPage";

vi.mock("@reward-planner/api-client", () => ({
  createWish: vi.fn(), getWishBoard: vi.fn(), getWishCoverUrl: vi.fn(), startWish: vi.fn(), switchWish: vi.fn(),
}));

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
function wish(id: string, title: string, progress = 0, status: WishBoardWish["status"] = "wishlist"): WishBoardWish {
  return { id, title, progress, status, target: 60, why: null, hasCover: false,
    startedAt: status === "unlocking" || progress > 0 ? "2026-11-08T00:00:00Z" : null,
    unlockedAt: null, redeemedAt: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe("Desktop Wish Board", () => {
  it("creates, starts and switches using refreshed server state", async () => {
    let data: WishBoardResponse = { wishes: [wish(b, "新相机")], recentDailyRewards: [] };
    vi.mocked(getWishBoard).mockImplementation(async () => data);
    vi.mocked(createWish).mockImplementation(async () => {
      data = { ...data, wishes: [...data.wishes, wish(a, "旅行")] };
      return {} as Awaited<ReturnType<typeof createWish>>;
    });
    vi.mocked(startWish).mockImplementation(async () => {
      data = { ...data, wishes: [wish(b, "新相机"), wish(a, "旅行", 1, "unlocking")] };
      return {} as Awaited<ReturnType<typeof startWish>>;
    });
    vi.mocked(switchWish).mockImplementation(async () => {
      data = { ...data, wishes: [wish(b, "新相机", 0, "unlocking"), wish(a, "旅行", 1)] };
      return {} as Awaited<ReturnType<typeof switchWish>>;
    });
    render(<WishBoardPage accessToken="fixture-token" />);
    await screen.findByText("还没有正在解锁的愿望");
    fireEvent.click(screen.getByRole("button", { name: /新建愿望/ }));
    expect((screen.getByRole("radio", { name: "60" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("愿望名称"), { target: { value: "旅行" } });
    fireEvent.click(screen.getByRole("button", { name: "创建愿望" }));
    const start = await screen.findByRole("button", { name: "开始解锁旅行" });
    expect(createWish).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ title: "旅行", target: 60 }) }));
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    const grid = await screen.findByRole("img", { name: /愿望进度 1 \/ 60/ });
    expect(grid.children).toHaveLength(60);
    expect(grid.querySelectorAll(".is-filled")).toHaveLength(1);
    expect(startWish).toHaveBeenCalledWith(expect.objectContaining({ input: { wishId: a } }));
    const choose = screen.getByRole("button", { name: "切换愿望" });
    await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(choose);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "新相机" }));
    await screen.findByRole("heading", { name: "新相机", level: 2 });
    expect(switchWish).toHaveBeenCalledWith(expect.objectContaining({ input: { wishId: b } }));
    expect(within(screen.getByRole("region", { name: "愿望清单" })).getByText("1 / 60")).toBeTruthy();
  });

  it("recovers from a failed read through the retry control", async () => {
    vi.mocked(getWishBoard).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ wishes: [], recentDailyRewards: [] });
    render(<WishBoardPage accessToken="fixture-token" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText("愿望清单是空的。")).toBeTruthy();
  });

  it.each([20, 40, 100])("submits the selected %i target directly", async target => {
    vi.mocked(getWishBoard).mockResolvedValue({ wishes: [], recentDailyRewards: [] });
    render(<WishBoardPage accessToken="fixture-token" />);
    await screen.findByText("愿望清单是空的。");
    fireEvent.click(screen.getByRole("button", { name: /新建愿望/ }));
    fireEvent.change(screen.getByLabelText("愿望名称"), { target: { value: "旅行" } });
    fireEvent.click(screen.getByRole("radio", { name: String(target) }));
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建愿望" }));
    await waitFor(() => expect(createWish).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ title: "旅行", target }),
    })));
  });

  it("validates and submits a custom target using the create contract", async () => {
    vi.mocked(getWishBoard).mockResolvedValue({ wishes: [], recentDailyRewards: [] });
    render(<WishBoardPage accessToken="fixture-token" />);
    await screen.findByText("愿望清单是空的。");
    fireEvent.click(screen.getByRole("button", { name: /新建愿望/ }));
    fireEvent.change(screen.getByLabelText("愿望名称"), { target: { value: "旅行" } });
    fireEvent.click(screen.getByRole("radio", { name: "自定义" }));
    const input = screen.getByRole("spinbutton", { name: "自定义进度目标" });
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("alert").textContent).toContain("有效的进度目标");
    expect(createWish).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "73" } });
    fireEvent.click(screen.getByRole("button", { name: "创建愿望" }));
    await waitFor(() => expect(createWish).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ target: 73 }),
    })));
  });

  it.each([[40, 10], [100, 25]])("renders 60 cells for a %i target", async (target, progress) => {
    vi.mocked(getWishBoard).mockResolvedValue({
      wishes: [{ ...wish(a, "旅行", progress, "unlocking"), target }], recentDailyRewards: [],
    });
    render(<WishBoardPage accessToken="fixture-token" />);
    const grid = await screen.findByRole("img", { name: `愿望进度 ${progress} / ${target}，25%` });
    expect(grid.children).toHaveLength(60);
    expect(grid.querySelectorAll(".is-filled")).toHaveLength(15);
  });

  it("distinguishes account rewards and their known destinations from a zero-progress wish", async () => {
    const createdAt = "2026-11-08T12:00:00Z";
    vi.mocked(getWishBoard).mockResolvedValue({
      wishes: [wish(a, "旅行", 0, "unlocking")],
      recentDailyRewards: [
        { id: "1", amount: 1, createdAt, destinations: [{ kind: "wish", title: "Kindle" }] },
        { id: "2", amount: 1, createdAt },
      ],
    });
    render(<WishBoardPage accessToken="fixture-token" />);
    await screen.findByRole("img", { name: "愿望进度 0 / 60，0%" });
    const rewards = within(screen.getByRole("region", { name: "近期账户奖励" }));
    expect(rewards.getAllByText("+1")).toHaveLength(2);
    expect(rewards.getByText("已分配给「Kindle」")).toBeTruthy();
    expect(rewards.queryByText("待分配进度")).toBeNull();
    expect(screen.getByText("合格日 +1")).toBeTruthy();
    expect(screen.getByText("完成项目里程碑可获得额外进度（后续接入）")).toBeTruthy();
  });

  it("opens both completed states, shows only available details, and restores focus on close", async () => {
    const unlockedAt = "2026-11-08T12:00:00Z";
    const redeemedAt = "2026-11-09T12:00:00Z";
    vi.mocked(getWishBoard).mockResolvedValue({
      wishes: [{ ...wish(a, "Kindle", 40, "redeemed"), target: 40, why: "阅读", hasCover: true, unlockedAt, redeemedAt },
        { ...wish(b, "音乐节门票", 60, "unlocked"), unlockedAt }],
      recentDailyRewards: [],
    });
    vi.mocked(getWishCoverUrl).mockResolvedValue({ data: { wishId: a, signedUrl: "https://example.test/cover", expiresIn: 300 } });
    render(<WishBoardPage accessToken="fixture-token" />);
    const kindle = await screen.findByRole("button", { name: "查看详情：Kindle" });
    kindle.focus();
    fireEvent.click(kindle);
    const redeemed = within(screen.getByRole("dialog", { name: "Kindle" }));
    expect(redeemed.getByText("已兑换")).toBeTruthy();
    expect(redeemed.getByText("40 / 40")).toBeTruthy();
    expect(redeemed.getByText("阅读")).toBeTruthy();
    expect(redeemed.getByText("兑换日期")).toBeTruthy();
    expect(await redeemed.findByRole("img", { name: "愿望封面" })).toBeTruthy();
    expect(redeemed.queryByText(/完成票据/)).toBeNull();
    fireEvent.click(redeemed.getByRole("button", { name: "关闭" }));
    expect(document.activeElement).toBe(kindle);
    fireEvent.click(screen.getByRole("button", { name: "查看详情：音乐节门票" }));
    const dialog = screen.getByRole("dialog", { name: "音乐节门票" });
    expect(within(dialog).getByText("已解锁")).toBeTruthy();
    expect(within(dialog).getByText("解锁日期")).toBeTruthy();
    expect(within(dialog).queryByText("兑换日期")).toBeNull();
    expect(within(dialog).queryByRole("img")).toBeNull();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

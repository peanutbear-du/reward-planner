// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopSidebar } from "./DesktopSidebar";

afterEach(cleanup);
describe("compact Desktop Sidebar", () => {
  it("keeps account controls collapsed and preserves the real sign-out action", () => {
    const onSignOut = vi.fn();
    render(<DesktopSidebar email="fixture@example.test" isSigningOut={false} signOutError={null} onSignOut={onSignOut} />);
    // jsdom does not model nested details visibility; Chrome verifies actual hiding.
    const disclosure = screen.getByLabelText("账号与主题").closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(screen.getByLabelText("账号与主题"));
    expect(disclosure.open).toBe(true);
    expect(screen.getByText("fixture@example.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
  it("keeps sign-out pending/error feedback visible in the account menu", () => {
    render(<DesktopSidebar isSigningOut signOutError="退出登录失败，请重试。" onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("账号与主题"));
    expect((screen.getByRole("button", { name: "正在退出…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("退出登录失败，请重试。");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { CancelDailyItemErrorCode, CancelDailyItemResponse } from "@reward-planner/types";
import type { AuthenticatedRequestContext } from "../../../../auth/authenticated-request";
import { CancelDailyItemCommandError } from "../../../../features/today/cancel-daily-item";
import { cancelDailyItemPostHandler } from "./cancel-handler";

const input = { date: "2026-09-21", itemId: "60000000-0000-4000-8000-000000000001" };
const output: CancelDailyItemResponse = { data: { ...input, dailyPlanId: "plan", resultStatus: "cancelled", changed: true }, effects: ["daily_item_cancelled"] };
const context = { supabase: {} } as AuthenticatedRequestContext;
const request = (body: unknown, token = "session") => new Request("http://localhost/api/commands/daily-item/cancel", {
  method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
});
describe("Cancel Daily Item route", () => {
  it("authenticates and passes only date + Item identity", async () => {
    const command = vi.fn(async () => output), authenticate = vi.fn(async () => context);
    const response = await cancelDailyItemPostHandler({ authenticate, command })(request(input));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(authenticate).toHaveBeenCalledWith("session"); expect(command).toHaveBeenCalledWith(context, input);
  });
  it("rejects missing/invalid Bearer auth before command", async () => {
    const authenticate = vi.fn(async () => null), command = vi.fn(async () => output);
    const handler = cancelDailyItemPostHandler({ authenticate, command });
    expect((await handler(request(input, ""))).status).toBe(401); expect(authenticate).not.toHaveBeenCalled();
    expect((await handler(request(input))).status).toBe(401); expect(command).not.toHaveBeenCalled();
  });
  it.each([{}, { ...input, date: "2026-02-30" }, { ...input, itemId: "bad" }, { ...input, taskId: input.itemId },
    { ...input, userId: input.itemId }, { ...input, resultStatus: "cancelled" }, { ...input, amount: 1 },
  ])("rejects invalid or forged consequences before auth %#", async (body) => {
    const authenticate = vi.fn(async () => context);
    expect((await cancelDailyItemPostHandler({ authenticate, command: async () => output })(request(body))).status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it.each<[CancelDailyItemErrorCode, number]>([
    ["AUTHENTICATION_REQUIRED", 401], ["INVALID_CANCEL_REQUEST", 400], ["DAILY_PLAN_NOT_FOUND", 404], ["DAILY_ITEM_NOT_FOUND", 404],
    ["DAILY_PLAN_NOT_COMMITTED", 409], ["DAILY_ITEM_CANCEL_NOT_ALLOWED", 409],
  ])("maps %s to HTTP %s", async (code, status) => {
    const response = await cancelDailyItemPostHandler({ authenticate: async () => context,
      command: async () => { throw new CancelDailyItemCommandError(code); } })(request(input));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: code });
  });
  it("rejects malformed JSON and hides unexpected details", async () => {
    expect((await cancelDailyItemPostHandler()(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
    const response = await cancelDailyItemPostHandler({ authenticate: async () => context, command: async () => { throw new Error("private SQL"); } })(request(input));
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

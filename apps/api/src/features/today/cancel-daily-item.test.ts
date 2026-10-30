import type { SupabaseClient } from "@supabase/supabase-js";
import type { CancelDailyItemData, CancelDailyItemErrorCode } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";
import { executeCancelDailyItem } from "./cancel-daily-item";
import { createSupabaseCancelDailyItemCommand } from "./supabase-cancel-daily-item-command";

const input = { date: "2026-09-21", itemId: "60000000-0000-4000-8000-000000000001" };
const result: CancelDailyItemData = { ...input, dailyPlanId: "plan", resultStatus: "cancelled", changed: true };
describe("Cancel Daily Item command", () => {
  it.each([true, false])("uses one RPC and server change=%s to emit effects", async (changed) => {
    const data = { ...result, changed }, rpc = vi.fn(async () => ({ data, error: null }));
    expect(await executeCancelDailyItem(input, createSupabaseCancelDailyItemCommand({ rpc } as unknown as SupabaseClient)))
      .toEqual({ data, effects: changed ? ["daily_item_cancelled"] : [] });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cancel_daily_item", { p_date: input.date, p_item_id: input.itemId });
  });
  it.each<CancelDailyItemErrorCode>([
    "AUTHENTICATION_REQUIRED", "INVALID_CANCEL_REQUEST", "DAILY_PLAN_NOT_FOUND", "DAILY_PLAN_NOT_COMMITTED", "DAILY_ITEM_NOT_FOUND", "DAILY_ITEM_CANCEL_NOT_ALLOWED",
  ])("preserves expected domain failure %s", async (message) => {
    await expect(createSupabaseCancelDailyItemCommand({ rpc: async () => ({ error: { message } }) } as unknown as SupabaseClient).execute(input)).rejects.toMatchObject({ code: message });
  });
  it.each([null, {}, { ...result, date: "other-date" }, { ...result, itemId: "foreign" },
    { ...result, resultStatus: "pending" }, { ...result, changed: "true" }, { ...result, dailyPlanId: null },
  ])("rejects malformed or mismatched data %#", async (data) => {
    await expect(createSupabaseCancelDailyItemCommand({ rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient).execute(input)).rejects.toThrow("invalid result");
  });
  it("does not expose private database errors", async () => {
    await expect(createSupabaseCancelDailyItemCommand({ rpc: async () => ({ error: { message: "private SQL detail" } }) } as unknown as SupabaseClient).execute(input))
      .rejects.toThrow("Failed to execute the Cancel Daily Item command.");
  });
});

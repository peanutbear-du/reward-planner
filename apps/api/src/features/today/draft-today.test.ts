import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { executeUpsertDraftTodayItem, executeRemoveDraftTodayItem } from "./draft-today";
import { createSupabaseUpsertDraftTodayItemCommand, createSupabaseRemoveDraftTodayItemCommand } from "./supabase-draft-today-command";

const identity = { date: "2026-10-03", taskId: "10000000-0000-4000-8000-000000000001" };
const data = {
  dailyPlanId: "daily-plan",
  item: {
    id: "daily-item", taskId: identity.taskId,
    origin: "initial" as const, priority: "must_do" as const, resultStatus: "pending" as const,
  },
};

describe("Draft Today commands", () => {
  it("executes narrow authenticated RPCs and returns only draft effects", async () => {
    const upsertRpc = vi.fn(async () => ({ data, error: null }));
    const upsert = createSupabaseUpsertDraftTodayItemCommand({ rpc: upsertRpc } as unknown as SupabaseClient);
    expect(await executeUpsertDraftTodayItem({ ...identity, priority: "must_do" }, upsert)).toEqual({
      data, effects: ["draft_item_upserted"],
    });
    expect(upsertRpc).toHaveBeenCalledWith("upsert_draft_today_item", {
      p_date: identity.date, p_task_id: identity.taskId, p_priority: "must_do",
    });
    const removed = { dailyPlanId: data.dailyPlanId, taskId: identity.taskId };
    const removeRpc = vi.fn(async () => ({ data: removed, error: null }));
    const remove = createSupabaseRemoveDraftTodayItemCommand({ rpc: removeRpc } as unknown as SupabaseClient);
    expect(await executeRemoveDraftTodayItem(identity, remove)).toEqual({
      data: removed, effects: ["draft_item_removed"],
    });
    expect(removeRpc).toHaveBeenCalledWith("remove_draft_today_item", {
      p_date: identity.date, p_task_id: identity.taskId,
    });
  });

  it.each([
    ["TASK_NOT_FOUND", 404],
    ["DRAFT_ITEM_NOT_FOUND", 404],
    ["DAILY_PLAN_ALREADY_COMMITTED", 409],
    ["TASK_NOT_DRAFT_ELIGIBLE", 409],
    ["DRAFT_ITEM_NOT_INITIAL", 409],
  ])("maps %s to %s", async (message, status) => {
    const rpc = vi.fn(async () => ({ data: null, error: { message } }));
    const client = { rpc } as unknown as SupabaseClient;
    await expect(createSupabaseUpsertDraftTodayItemCommand(client).execute({ ...identity, priority: "must_do" }))
      .rejects.toMatchObject({ code: message, status });
    await expect(createSupabaseRemoveDraftTodayItemCommand(client).execute(identity))
      .rejects.toMatchObject({ code: message, status });
  });

  it("rejects unexpected DB errors and malformed RPC results", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "private DB detail" } }) } as unknown as SupabaseClient;
    await expect(createSupabaseUpsertDraftTodayItemCommand(client).execute({ ...identity, priority: "must_do" }))
      .rejects.toThrow("Failed to execute the Draft Today command.");
    const malformed = { rpc: async () => ({ data: { dailyPlanId: "plan", taskId: "wrong-id" }, error: null }) } as unknown as SupabaseClient;
    await expect(createSupabaseUpsertDraftTodayItemCommand(malformed).execute({ ...identity, priority: "must_do" }))
      .rejects.toThrow("invalid upsert result");
    await expect(createSupabaseRemoveDraftTodayItemCommand(malformed).execute(identity))
      .rejects.toThrow("invalid removal result");
  });
});

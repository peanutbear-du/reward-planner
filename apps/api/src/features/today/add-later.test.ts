import type { AddLaterResponse } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { executeAddLater } from "./add-later";
import { createSupabaseAddLaterCommand } from "./supabase-add-later-command";

const taskId = "10000000-0000-4000-8000-000000000001";
const data: AddLaterResponse["data"] = {
  dailyPlanId: "plan", item: {
    id: "item", taskId, origin: "added_later", priority: "must_do", resultStatus: "pending",
    title: "Frozen title", plannedStartTime: "09:00:00", plannedEndTime: "10:00:00",
    completedAtOnDay: null, rescheduledToDate: null,
  },
};

describe("Added Later command", () => {
  it("executes the narrow authenticated RPC without qualification/reward effects", async () => {
    const rpc = vi.fn(async () => ({ data, error: null }));
    const command = createSupabaseAddLaterCommand({ rpc } as unknown as SupabaseClient);
    const input = { date: "2026-10-10", taskId, priority: "must_do" as const };
    expect(await executeAddLater(input, command)).toEqual({ data, effects: ["daily_item_added_later"] });
    expect(rpc).toHaveBeenCalledWith("add_later_today_item", {
      p_date: input.date, p_task_id: taskId, p_priority: "must_do",
    });
  });

  it("preserves the original RPC item on a retry with a different priority", async () => {
    const client = { rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient;
    expect(await createSupabaseAddLaterCommand(client).execute({ date: "2026-10-10", taskId, priority: "plan" })).toEqual(data);
  });

  it.each([
    ["DAILY_PLAN_NOT_FOUND", 404], ["DAILY_PLAN_NOT_COMMITTED", 409], ["TASK_NOT_FOUND", 404],
    ["TASK_NOT_ADDED_LATER_ELIGIBLE", 409], ["INITIAL_ITEM_ALREADY_EXISTS", 409],
  ])("maps %s to %s", async (message, status) => {
    const client = { rpc: async () => ({ data: null, error: { message } }) } as unknown as SupabaseClient;
    await expect(createSupabaseAddLaterCommand(client).execute({ date: "2026-10-10", taskId, priority: "plan" }))
      .rejects.toMatchObject({ code: message, status });
  });

  it("wraps unexpected DB failures", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "private SQL detail" } }) } as unknown as SupabaseClient;
    await expect(createSupabaseAddLaterCommand(client).execute({ date: "2026-10-10", taskId, priority: "plan" }))
      .rejects.toThrow("Failed to execute the Added Later command.");
  });

  it.each([
    null, {}, { ...data, item: { ...data.item, origin: "initial" } },
    { ...data, item: { ...data.item, taskId: "another-task" } },
    { ...data, item: { ...data.item, plannedStartTime: undefined } },
    { ...data, item: { ...data.item, priority: "urgent" } },
  ])("rejects malformed or mismatched result %#", async (invalid) => {
    const client = { rpc: async () => ({ data: invalid, error: null }) } as unknown as SupabaseClient;
    await expect(createSupabaseAddLaterCommand(client).execute({ date: "2026-10-10", taskId, priority: "plan" }))
      .rejects.toThrow("Added Later returned an invalid result.");
  });
});

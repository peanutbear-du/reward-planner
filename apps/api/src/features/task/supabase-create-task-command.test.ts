import type { CreateTaskResponse } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseCreateTaskCommand } from "./supabase-create-task-command";

const data: CreateTaskResponse["data"] = {
  task: {
    id: "task-1",
    title: "Timed Task",
    status: "open",
    completedAt: null,
    createdAt: "2026-09-29T01:00:00Z",
    updatedAt: "2026-09-29T01:00:00Z",
  },
  planningItem: {
    id: "planning-1",
    taskId: "task-1",
    plannedDate: "2026-09-29",
    startTime: "09:00",
    endTime: "10:00",
    createdAt: "2026-09-29T01:00:00Z",
    updatedAt: "2026-09-29T01:00:00Z",
  },
};

describe("createSupabaseCreateTaskCommand", () => {
  it("calls the authenticated RPC with only command parameters", async () => {
    const rpc = vi.fn(async () => ({ data, error: null }));
    const command = createSupabaseCreateTaskCommand({ rpc } as unknown as SupabaseClient);

    await expect(
      command.execute({
        title: "Timed Task",
        schedule: {
          plannedDate: "2026-09-29",
          startTime: "09:00",
          endTime: "10:00",
        },
      }),
    ).resolves.toEqual(data);

    expect(rpc).toHaveBeenCalledWith("create_task", {
      p_end_time: "10:00",
      p_planned_date: "2026-09-29",
      p_start_time: "09:00",
      p_title: "Timed Task",
    });
  });

  it("passes null schedule parameters without inventing a Planning Item", async () => {
    const taskOnly = { ...data, planningItem: null };
    const rpc = vi.fn(async () => ({ data: taskOnly, error: null }));
    const command = createSupabaseCreateTaskCommand({ rpc } as unknown as SupabaseClient);

    await expect(
      command.execute({ title: "Task only", schedule: null }),
    ).resolves.toEqual(taskOnly);
    expect(rpc).toHaveBeenCalledWith("create_task", {
      p_end_time: null,
      p_planned_date: null,
      p_start_time: null,
      p_title: "Task only",
    });
  });

  it("turns database errors and malformed results into non-sensitive failures", async () => {
    const failedRpc = vi.fn(async () => ({
      data: null,
      error: { message: "sensitive database detail" },
    }));
    const malformedRpc = vi.fn(async () => ({ data: {}, error: null }));

    await expect(
      createSupabaseCreateTaskCommand({
        rpc: failedRpc,
      } as unknown as SupabaseClient).execute({ title: "Task", schedule: null }),
    ).rejects.toThrow("Failed to execute the Create Task command.");
    await expect(
      createSupabaseCreateTaskCommand({
        rpc: malformedRpc,
      } as unknown as SupabaseClient).execute({ title: "Task", schedule: null }),
    ).rejects.toThrow("Create Task returned an invalid result.");
  });
});

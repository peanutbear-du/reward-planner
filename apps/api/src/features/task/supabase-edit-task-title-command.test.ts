import type { EditTaskTitleResponse } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseEditTaskTitleCommand } from "./supabase-edit-task-title-command";

const data: EditTaskTitleResponse["data"] = {
  task: {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Updated title",
    status: "open",
    completedAt: null,
    createdAt: "2026-09-30T01:00:00Z",
    updatedAt: "2026-09-30T02:00:00Z",
  },
};

describe("createSupabaseEditTaskTitleCommand", () => {
  it("calls the authenticated RPC with only Task id and title", async () => {
    const rpc = vi.fn(async () => ({ data, error: null }));
    const command = createSupabaseEditTaskTitleCommand({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      command.execute({ taskId: data.task.id, title: data.task.title }),
    ).resolves.toEqual(data);
    expect(rpc).toHaveBeenCalledWith("edit_task_title", {
      p_task_id: data.task.id,
      p_title: data.task.title,
    });
  });

  it.each([
    ["TASK_NOT_FOUND", "not_found"],
    ["TASK_EDIT_NOT_ALLOWED", "conflict"],
  ] as const)("maps %s to a controlled %s failure", async (message, kind) => {
    const rpc = vi.fn(async () => ({ data: null, error: { message } }));

    await expect(
      createSupabaseEditTaskTitleCommand({
        rpc,
      } as unknown as SupabaseClient).execute({
        taskId: data.task.id,
        title: data.task.title,
      }),
    ).rejects.toMatchObject({ kind });
  });

  it("turns unexpected database errors and malformed results into safe failures", async () => {
    const failedRpc = vi.fn(async () => ({
      data: null,
      error: { message: "sensitive database detail" },
    }));
    const malformedRpc = vi.fn(async () => ({ data: {}, error: null }));

    await expect(
      createSupabaseEditTaskTitleCommand({
        rpc: failedRpc,
      } as unknown as SupabaseClient).execute({
        taskId: data.task.id,
        title: data.task.title,
      }),
    ).rejects.toThrow("Failed to execute the Edit Task command.");
    await expect(
      createSupabaseEditTaskTitleCommand({
        rpc: malformedRpc,
      } as unknown as SupabaseClient).execute({
        taskId: data.task.id,
        title: data.task.title,
      }),
    ).rejects.toThrow("Edit Task returned an invalid result.");
  });
});

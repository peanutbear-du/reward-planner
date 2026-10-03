import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseDeleteTaskCommand } from "./supabase-delete-task-command";

const taskId = "10000000-0000-4000-8000-000000000001";

describe("createSupabaseDeleteTaskCommand", () => {
  it("calls the authenticated RPC with only the Task id", async () => {
    const rpc = vi.fn(async () => ({ data: { taskId }, error: null }));
    const command = createSupabaseDeleteTaskCommand({
      rpc,
    } as unknown as SupabaseClient);

    await expect(command.execute({ taskId })).resolves.toEqual({ taskId });
    expect(rpc).toHaveBeenCalledWith("delete_task", { p_task_id: taskId });
  });

  it.each([
    ["TASK_NOT_FOUND", "not_found"],
    ["TASK_DELETE_NOT_ALLOWED", "conflict"],
  ] as const)("maps %s to a controlled %s failure", async (message, kind) => {
    const rpc = vi.fn(async () => ({ data: null, error: { message } }));

    await expect(
      createSupabaseDeleteTaskCommand({
        rpc,
      } as unknown as SupabaseClient).execute({ taskId }),
    ).rejects.toMatchObject({ kind });
  });

  it("rejects unexpected database errors and mismatched results", async () => {
    const failedRpc = vi.fn(async () => ({
      data: null,
      error: { message: "sensitive database detail" },
    }));
    const malformedRpc = vi.fn(async () => ({
      data: { taskId: "different-task" },
      error: null,
    }));

    await expect(
      createSupabaseDeleteTaskCommand({
        rpc: failedRpc,
      } as unknown as SupabaseClient).execute({ taskId }),
    ).rejects.toThrow("Failed to execute the Delete Task command.");
    await expect(
      createSupabaseDeleteTaskCommand({
        rpc: malformedRpc,
      } as unknown as SupabaseClient).execute({ taskId }),
    ).rejects.toThrow("Delete Task returned an invalid result.");
  });
});

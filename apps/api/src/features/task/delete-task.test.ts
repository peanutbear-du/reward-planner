import type { DeleteTaskResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import { executeDeleteTask } from "./delete-task";

const data: DeleteTaskResponse["data"] = {
  taskId: "10000000-0000-4000-8000-000000000001",
};

describe("executeDeleteTask", () => {
  it("returns the deleted identity with the task_deleted effect", async () => {
    const execute = vi.fn(async () => data);
    const input = { taskId: data.taskId };

    await expect(executeDeleteTask(input, { execute })).resolves.toEqual({
      data,
      effects: ["task_deleted"],
    });
    expect(execute).toHaveBeenCalledWith(input);
  });
});

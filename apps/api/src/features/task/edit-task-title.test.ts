import type { EditTaskTitleResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import { executeEditTaskTitle } from "./edit-task-title";

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

describe("executeEditTaskTitle", () => {
  it("returns the edited Task with the task_updated effect", async () => {
    const execute = vi.fn(async () => data);
    const input = { taskId: data.task.id, title: "Updated title" };

    await expect(executeEditTaskTitle(input, { execute })).resolves.toEqual({
      data,
      effects: ["task_updated"],
    });
    expect(execute).toHaveBeenCalledWith(input);
  });
});

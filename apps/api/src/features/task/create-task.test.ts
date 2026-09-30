import type { CreateTaskResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import { executeCreateTask } from "./create-task";

const data: CreateTaskResponse["data"] = {
  task: {
    id: "task-1",
    title: "Write report",
    status: "open",
    completedAt: null,
    createdAt: "2026-09-29T01:00:00Z",
    updatedAt: "2026-09-29T01:00:00Z",
  },
  planningItem: null,
};

describe("executeCreateTask", () => {
  it("returns the command data with the task_created effect", async () => {
    const execute = vi.fn(async () => data);
    const input = { title: "Write report", schedule: null };

    await expect(executeCreateTask(input, { execute })).resolves.toEqual({
      data,
      effects: ["task_created"],
    });
    expect(execute).toHaveBeenCalledWith(input);
  });
});

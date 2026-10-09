import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseTodayDataSource } from "./supabase-today-data-source";

describe("Draft Today Planning Item query", () => {
  it("filters by both Task ids and the Draft date without writing the schedule", async () => {
    const eq = vi.fn(async () => ({
      data: [{ id: "planning", task_id: "task", start_time: "09:00:00", end_time: "10:00:00" }], error: null,
    }));
    const inFilter = vi.fn(() => ({ eq }));
    const select = vi.fn(() => ({ in: inFilter }));
    const from = vi.fn(() => ({ select }));
    const dataSource = createSupabaseTodayDataSource({ from } as unknown as SupabaseClient);
    expect(await dataSource.getPlanningItemsForTasks(["task"], "2026-10-03")).toEqual([
      { id: "planning", taskId: "task", startTime: "09:00:00", endTime: "10:00:00" },
    ]);
    expect(from).toHaveBeenCalledWith("planning_items");
    expect(inFilter).toHaveBeenCalledWith("task_id", ["task"]);
    expect(eq).toHaveBeenCalledWith("planned_date", "2026-10-03");
  });
});

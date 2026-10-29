import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseTodayDataSource } from "./supabase-today-data-source";

describe("Draft Today Planning Item query", () => {
  it("reads Task eligibility fields through the same scoped client", async () => {
    const inFilter = vi.fn(async () => ({ data: [{ id: "task", title: "Task", status: "completed", project_id: null, milestone_id: null }], error: null }));
    const select = vi.fn(() => ({ in: inFilter })), from = vi.fn(() => ({ select }));
    const source = createSupabaseTodayDataSource({ from } as unknown as SupabaseClient);
    expect(await source.getTasks(["task"])).toEqual([{ id: "task", title: "Task", status: "completed", projectId: null, milestoneId: null }]);
    expect(select).toHaveBeenCalledWith("id,title,status,project_id,milestone_id");
    expect(inFilter).toHaveBeenCalledWith("id", ["task"]);
  });
  it("reads persisted per-day qualification fields using the date and RLS-scoped client", async () => {
    const maybeSingle = vi.fn(async () => ({ data: {
      id: "plan", status: "committed", snapshot_created_at: "2026-10-26T00:00:00Z",
      total_item_count: 5, completed_item_count: 4, must_do_item_count: 2,
      completed_must_do_item_count: 2, completion_rate: 80, is_qualified: true,
      qualified_at: "2026-10-26T02:00:00Z", qualification_calculated_at: "2026-10-26T02:00:00Z",
    }, error: null }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const source = createSupabaseTodayDataSource({ from } as unknown as SupabaseClient);
    expect(await source.getDailyPlan("2026-10-26")).toEqual({
      id: "plan", status: "committed", snapshotCreatedAt: "2026-10-26T00:00:00Z",
      totalItems: 5, completedItems: 4, mustDoItems: 2, completedMustDoItems: 2,
      completionRate: 80, isQualified: true, qualifiedAt: "2026-10-26T02:00:00Z",
      calculatedAt: "2026-10-26T02:00:00Z",
    });
    expect(from).toHaveBeenCalledWith("daily_plans");
    expect(select).toHaveBeenCalledWith(expect.stringContaining("qualification_calculated_at"));
    expect(eq).toHaveBeenCalledWith("plan_date", "2026-10-26");
  });
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

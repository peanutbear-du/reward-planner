import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DailyPlanItemRecord,
  DailyPlanRecord,
  PlanningItemRecord,
  TimedPlanningItemRecord,
  TodayDataSource,
} from "./today-data-source";

interface DailyPlanDatabaseRow {
  id: string;
  status: DailyPlanRecord["status"];
  snapshot_created_at: string | null;
}

interface DailyPlanItemDatabaseRow {
  id: string;
  task_id: string;
  origin: DailyPlanItemRecord["origin"];
  priority: DailyPlanItemRecord["priority"];
  result_status: DailyPlanItemRecord["resultStatus"];
  title_snapshot: string;
  planned_start_time_snapshot: string | null;
  planned_end_time_snapshot: string | null;
  completed_at_on_day: string | null;
  rescheduled_to_date: string | null;
}

interface PlanningItemDatabaseRow {
  id: string;
  task_id: string;
  start_time: string | null;
  end_time: string | null;
}

interface TaskDatabaseRow {
  id: string;
  title: string;
}

export function createSupabaseTodayDataSource(
  supabase: SupabaseClient,
): TodayDataSource {
  return {
    async getTimezone() {
      const { data, error } = await supabase
        .from("user_settings")
        .select("timezone")
        .maybeSingle();

      assertQuerySucceeded(error, "user timezone");
      return (data as { timezone: string } | null)?.timezone ?? null;
    },

    async getDailyPlan(date) {
      const { data, error } = await supabase
        .from("daily_plans")
        .select("id,status,snapshot_created_at")
        .eq("plan_date", date)
        .maybeSingle();

      assertQuerySucceeded(error, "Daily Plan");
      const row = data as DailyPlanDatabaseRow | null;

      return row
        ? {
            id: row.id,
            status: row.status,
            snapshotCreatedAt: row.snapshot_created_at,
          }
        : null;
    },

    async getDailyPlanItems(dailyPlanId) {
      const { data, error } = await supabase
        .from("daily_plan_items")
        .select(
          "id,task_id,origin,priority,result_status,title_snapshot,planned_start_time_snapshot,planned_end_time_snapshot,completed_at_on_day,rescheduled_to_date",
        )
        .eq("daily_plan_id", dailyPlanId)
        .not("task_id", "is", null)
        .order("added_at", { ascending: true });

      assertQuerySucceeded(error, "Daily Plan Items");

      return ((data ?? []) as DailyPlanItemDatabaseRow[]).map((row) => ({
        id: row.id,
        taskId: row.task_id,
        origin: row.origin,
        priority: row.priority,
        resultStatus: row.result_status,
        titleSnapshot: row.title_snapshot,
        plannedStartTimeSnapshot: row.planned_start_time_snapshot,
        plannedEndTimeSnapshot: row.planned_end_time_snapshot,
        completedAtOnDay: row.completed_at_on_day,
        rescheduledToDate: row.rescheduled_to_date,
      }));
    },

    async getPlanningItemsForTasks(taskIds) {
      if (taskIds.length === 0) {
        return [];
      }

      const { data, error } = await supabase
        .from("planning_items")
        .select("id,task_id,start_time,end_time")
        .in("task_id", taskIds);

      assertQuerySucceeded(error, "Task Planning Items");
      return mapPlanningItems((data ?? []) as PlanningItemDatabaseRow[]);
    },

    async getTimedPlanningItemsForDate(date) {
      const { data, error } = await supabase
        .from("planning_items")
        .select("id,task_id,start_time,end_time")
        .eq("planned_date", date)
        .not("task_id", "is", null)
        .not("start_time", "is", null)
        .order("start_time", { ascending: true });

      assertQuerySucceeded(error, "Timed Planning Items");

      return mapPlanningItems(
        (data ?? []) as PlanningItemDatabaseRow[],
      ).filter((row): row is TimedPlanningItemRecord => row.startTime !== null);
    },

    async getTasks(taskIds) {
      if (taskIds.length === 0) {
        return [];
      }

      const { data, error } = await supabase
        .from("tasks")
        .select("id,title")
        .in("id", taskIds);

      assertQuerySucceeded(error, "Tasks");
      return (data ?? []) as TaskDatabaseRow[];
    },
  };
}

function mapPlanningItems(rows: PlanningItemDatabaseRow[]): PlanningItemRecord[] {
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

function assertQuerySucceeded(error: unknown, operation: string): asserts error is null {
  if (error) {
    throw new Error(`Failed to query ${operation}.`, { cause: error });
  }
}

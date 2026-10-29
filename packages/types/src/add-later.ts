import type { DailyPlanItemPriority, TodayItem } from "./today";

export interface AddLaterRequest {
  date: string;
  taskId: string;
  priority: DailyPlanItemPriority;
}

export interface AddLaterResponse {
  data: {
    dailyPlanId: string;
    // Eligibility is a GET Today projection, not part of this existing RPC.
    item: Omit<TodayItem, "canReschedule"> & { origin: "added_later" };
  };
  effects: ["daily_item_added_later"];
}

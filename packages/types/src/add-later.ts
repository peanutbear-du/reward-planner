import type { DailyPlanItemPriority, TodayItem } from "./today";

export interface AddLaterRequest {
  date: string;
  taskId: string;
  priority: DailyPlanItemPriority;
}

export interface AddLaterResponse {
  data: {
    dailyPlanId: string;
    item: TodayItem & { origin: "added_later" };
  };
  effects: ["daily_item_added_later"];
}

import type { DailyPlanItemPriority } from "./today";

export interface UpsertDraftTodayItemRequest {
  date: string;
  taskId: string;
  priority: DailyPlanItemPriority;
}

export interface RemoveDraftTodayItemRequest {
  date: string;
  taskId: string;
}

export interface UpsertDraftTodayItemResponse {
  data: {
    dailyPlanId: string;
    item: {
      id: string;
      taskId: string;
      origin: "initial";
      priority: DailyPlanItemPriority;
      resultStatus: "pending";
    };
  };
  effects: ["draft_item_upserted"];
}

export interface RemoveDraftTodayItemResponse {
  data: {
    dailyPlanId: string;
    taskId: string;
  };
  effects: ["draft_item_removed"];
}

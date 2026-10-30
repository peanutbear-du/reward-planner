export interface CancelDailyItemRequest {
  date: string;
  itemId: string;
}

export interface CancelDailyItemData extends CancelDailyItemRequest {
  dailyPlanId: string;
  resultStatus: "cancelled";
  changed: boolean;
}

export interface CancelDailyItemResponse {
  data: CancelDailyItemData;
  effects: [] | ["daily_item_cancelled"];
}

export type CancelDailyItemErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_CANCEL_REQUEST"
  | "DAILY_PLAN_NOT_FOUND"
  | "DAILY_PLAN_NOT_COMMITTED"
  | "DAILY_ITEM_NOT_FOUND"
  | "DAILY_ITEM_CANCEL_NOT_ALLOWED";

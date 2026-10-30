import type { CancelDailyItemData, CancelDailyItemErrorCode, CancelDailyItemRequest, CancelDailyItemResponse } from "@reward-planner/types";

export class CancelDailyItemCommandError extends Error {
  constructor(readonly code: CancelDailyItemErrorCode) {
    super(code);
    this.name = "CancelDailyItemCommandError";
  }
}

export interface CancelDailyItemCommand {
  execute(input: CancelDailyItemRequest): Promise<CancelDailyItemData>;
}

export async function executeCancelDailyItem(input: CancelDailyItemRequest, command: CancelDailyItemCommand): Promise<CancelDailyItemResponse> {
  const data = await command.execute(input);
  return { data, effects: data.changed ? ["daily_item_cancelled"] : [] };
}

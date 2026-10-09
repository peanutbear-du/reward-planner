import type {
  UpsertDraftTodayItemRequest,
  UpsertDraftTodayItemResponse,
  RemoveDraftTodayItemRequest,
  RemoveDraftTodayItemResponse,
} from "@reward-planner/types";

export interface UpsertDraftTodayItemCommand {
  execute(input: UpsertDraftTodayItemRequest): Promise<UpsertDraftTodayItemResponse["data"]>;
}

export interface RemoveDraftTodayItemCommand {
  execute(input: RemoveDraftTodayItemRequest): Promise<RemoveDraftTodayItemResponse["data"]>;
}

export async function executeUpsertDraftTodayItem(
  input: UpsertDraftTodayItemRequest,
  command: UpsertDraftTodayItemCommand,
): Promise<UpsertDraftTodayItemResponse> {
  return { data: await command.execute(input), effects: ["draft_item_upserted"] };
}

export async function executeRemoveDraftTodayItem(
  input: RemoveDraftTodayItemRequest,
  command: RemoveDraftTodayItemCommand,
): Promise<RemoveDraftTodayItemResponse> {
  return { data: await command.execute(input), effects: ["draft_item_removed"] };
}

export type DraftTodayErrorCode =
  | "TASK_NOT_FOUND"
  | "DRAFT_ITEM_NOT_FOUND"
  | "DAILY_PLAN_ALREADY_COMMITTED"
  | "TASK_NOT_DRAFT_ELIGIBLE"
  | "DRAFT_ITEM_NOT_INITIAL";

export class DraftTodayCommandError extends Error {
  constructor(readonly code: DraftTodayErrorCode) {
    super(code);
    this.name = "DraftTodayCommandError";
  }

  get status(): number {
    return this.code === "TASK_NOT_FOUND" || this.code === "DRAFT_ITEM_NOT_FOUND"
      ? 404
      : 409;
  }
}

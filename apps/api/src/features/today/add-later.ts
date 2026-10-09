import type { AddLaterRequest, AddLaterResponse } from "@reward-planner/types";

export interface AddLaterCommand {
  execute(input: AddLaterRequest): Promise<AddLaterResponse["data"]>;
}

export async function executeAddLater(
  input: AddLaterRequest,
  command: AddLaterCommand,
): Promise<AddLaterResponse> {
  return { data: await command.execute(input), effects: ["daily_item_added_later"] };
}

export type AddLaterErrorCode =
  | "DAILY_PLAN_NOT_FOUND"
  | "DAILY_PLAN_NOT_COMMITTED"
  | "TASK_NOT_FOUND"
  | "TASK_NOT_ADDED_LATER_ELIGIBLE"
  | "INITIAL_ITEM_ALREADY_EXISTS";

export class AddLaterCommandError extends Error {
  constructor(readonly code: AddLaterErrorCode) {
    super(code);
    this.name = "AddLaterCommandError";
  }

  get status(): number {
    return this.code === "DAILY_PLAN_NOT_FOUND" || this.code === "TASK_NOT_FOUND"
      ? 404 : 409;
  }
}

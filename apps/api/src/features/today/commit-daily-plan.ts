import type { CommitDailyPlanRequest, CommitDailyPlanResponse } from "@reward-planner/types";

export interface CommitDailyPlanCommand {
  execute(input: CommitDailyPlanRequest): Promise<CommitDailyPlanResponse["data"]>;
}

export async function executeCommitDailyPlan(
  input: CommitDailyPlanRequest,
  command: CommitDailyPlanCommand,
): Promise<CommitDailyPlanResponse> {
  return { data: await command.execute(input), effects: ["daily_plan_committed"] };
}

export type CommitDailyPlanErrorCode =
  | "DAILY_PLAN_NOT_FOUND"
  | "DAILY_PLAN_EMPTY"
  | "DAILY_PLAN_ITEMS_INVALID";

export class CommitDailyPlanCommandError extends Error {
  constructor(readonly code: CommitDailyPlanErrorCode) {
    super(code);
    this.name = "CommitDailyPlanCommandError";
  }

  get status(): number {
    return this.code === "DAILY_PLAN_NOT_FOUND" ? 404 : 409;
  }
}

import { startWishRequestSchema } from "@reward-planner/schemas";
import type { StartWishRequest, StartWishResponse, StartWishErrorCode } from "@reward-planner/types";

export interface StartWishCommand { execute(input: StartWishRequest): Promise<StartWishResponse> }
export class StartWishCommandError extends Error {
  constructor(readonly code: StartWishErrorCode) { super(code); this.name = "StartWishCommandError"; }
}
export async function executeStartWish(input: StartWishRequest, command: StartWishCommand): Promise<StartWishResponse> {
  const parsed = startWishRequestSchema.safeParse(input);
  if (!parsed.success) throw new StartWishCommandError("INVALID_WISH_START_REQUEST");
  // Effects and all progress/state are confirmed by the transaction, not inferred here.
  return command.execute(parsed.data);
}

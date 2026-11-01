import type { CreateWishErrorCode, CreateWishRequest, CreateWishResponse } from "@reward-planner/types";
import { createWishRequestSchema } from "@reward-planner/schemas";

export interface CreateWishCommand {
  execute(input: CreateWishRequest): Promise<CreateWishResponse["data"]>;
}
export class CreateWishCommandError extends Error {
  constructor(readonly code: CreateWishErrorCode) { super(code); this.name = "CreateWishCommandError"; }
}
export async function executeCreateWish(input: CreateWishRequest, command: CreateWishCommand): Promise<CreateWishResponse> {
  const parsed = createWishRequestSchema.safeParse(input);
  if (!parsed.success) throw new CreateWishCommandError("INVALID_WISH_REQUEST");
  return { data: await command.execute(parsed.data), effects: ["wish_created"] };
}

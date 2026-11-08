import type { SupabaseClient } from "@supabase/supabase-js";
import type { StartWishErrorCode } from "@reward-planner/types";
import { startWishResponseSchema } from "@reward-planner/schemas";
import { StartWishCommandError, type StartWishCommand } from "./start-wish";

const businessErrors: StartWishErrorCode[] = ["AUTHENTICATION_REQUIRED", "INVALID_WISH_START_REQUEST", "WISH_NOT_FOUND",
  "WISH_ALREADY_UNLOCKING", "WISH_NOT_UNLOCKING", "WISH_START_NOT_ALLOWED", "REWARD_ALLOCATION_INCONSISTENT"];
export function createSupabaseStartWishCommand(user: SupabaseClient, mode: "start" | "switch"): StartWishCommand {
  return {
    async execute(input) {
      const { data, error } = await user.rpc(mode === "start" ? "start_wish" : "switch_wish", { p_wish_id: input.wishId });
      if (error) {
        if (businessErrors.includes(error.message as StartWishErrorCode)) throw new StartWishCommandError(error.message as StartWishErrorCode);
        if (["PGRST202", "PGRST205", "42P01", "42883", "55P03", "57014", "40P01", "40001"].includes(error.code)) {
          throw new StartWishCommandError("WISH_START_UNAVAILABLE");
        }
        throw Error("Failed to execute Wish lifecycle command");
      }
      const parsed = startWishResponseSchema.safeParse(data);
      if (!parsed.success || parsed.data.data.wish.id !== input.wishId
        || (mode === "start" && parsed.data.data.previousWish !== null)
        || (mode === "switch" && parsed.data.data.changed && parsed.data.data.previousWish === null)) {
        throw Error("Wish lifecycle returned an invalid result");
      }
      return parsed.data;
    },
  };
}

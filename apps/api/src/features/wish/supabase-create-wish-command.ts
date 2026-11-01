import type { SupabaseClient } from "@supabase/supabase-js";
import { createdWishSchema } from "@reward-planner/schemas";
import { CreateWishCommandError, type CreateWishCommand } from "./create-wish";

// Offline contract only: create_wish is NOT installed by this ticket yet.
export function createSupabaseCreateWishCommand(supabase: SupabaseClient): CreateWishCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("create_wish", {
        p_title: input.title, p_target: input.target,
        p_reference_price: input.referencePrice ?? null, p_why: input.why ?? null,
      });
      if (error) {
        if (error.message === "AUTHENTICATION_REQUIRED" || error.message === "INVALID_WISH_REQUEST") {
          throw new CreateWishCommandError(error.message);
        }
        if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code)) {
          throw new CreateWishCommandError("WISH_CREATION_UNAVAILABLE");
        }
        throw new Error("Failed to execute Create Wish.", { cause: error });
      }
      const parsed = createdWishSchema.safeParse(data?.wish);
      if (!parsed.success || parsed.data.title !== input.title || parsed.data.target !== input.target
        || parsed.data.referencePrice !== (input.referencePrice ?? null) || parsed.data.why !== (input.why ?? null)) {
        throw new Error("Create Wish returned an invalid result.");
      }
      return { wish: parsed.data };
    },
  };
}

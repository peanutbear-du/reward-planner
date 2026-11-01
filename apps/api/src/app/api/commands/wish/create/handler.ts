import { createWishRequestSchema } from "@reward-planner/schemas";
import type { CreateWishRequest, CreateWishResponse } from "@reward-planner/types";
import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { executeCreateWish, CreateWishCommandError } from "../../../../../features/wish/create-wish";
import { createSupabaseCreateWishCommand } from "../../../../../features/wish/supabase-create-wish-command";

interface Dependencies {
  authenticate(token: string): Promise<AuthenticatedRequestContext | null>;
  command(context: AuthenticatedRequestContext, input: CreateWishRequest): Promise<CreateWishResponse>;
}
const defaults: Dependencies = {
  authenticate: authenticateAccessToken,
  command: (context, input) => executeCreateWish(input, createSupabaseCreateWishCommand(context.supabase)),
};
export function createWishPostHandler(dependencies = defaults) {
  return async (request: Request) => {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
    const input = createWishRequestSchema.safeParse(body);
    if (!input.success) return json({ error: "INVALID_REQUEST" }, 400);
    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return json({ error: "UNAUTHORIZED" }, 401);
    try {
      const context = await dependencies.authenticate(token);
      if (!context) return json({ error: "UNAUTHORIZED" }, 401);
      return json(await dependencies.command(context, input.data), 201);
    } catch (error) {
      if (error instanceof CreateWishCommandError) return json({ error: error.code },
        error.code === "AUTHENTICATION_REQUIRED" ? 401 : error.code === "INVALID_WISH_REQUEST" ? 400 : 503);
      return json({ error: "INTERNAL_SERVER_ERROR" }, 500);
    }
  };
}
function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

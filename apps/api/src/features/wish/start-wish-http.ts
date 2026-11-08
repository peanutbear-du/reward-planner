import { startWishRequestSchema } from "@reward-planner/schemas";
import type { StartWishRequest, StartWishResponse } from "@reward-planner/types";
import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../auth/authenticated-request";
import { executeStartWish, StartWishCommandError } from "./start-wish";
import { createSupabaseStartWishCommand } from "./supabase-start-wish-command";

interface Dependencies {
  authenticate(token: string): Promise<AuthenticatedRequestContext | null>;
  command(context: AuthenticatedRequestContext, input: StartWishRequest): Promise<StartWishResponse>;
}
export function startWishPostHandler(mode: "start" | "switch", dependencies: Dependencies = {
  authenticate: authenticateAccessToken,
  command: (context, input) => executeStartWish(input, createSupabaseStartWishCommand(context.supabase, mode)),
}) {
  return async (request: Request) => {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
    const parsed = startWishRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: "INVALID_REQUEST" }, 400);
    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return json({ error: "UNAUTHORIZED" }, 401);
    try {
      const context = await dependencies.authenticate(token);
      if (!context) return json({ error: "UNAUTHORIZED" }, 401);
      return json(await dependencies.command(context, parsed.data), 200);
    } catch (error) {
      if (!(error instanceof StartWishCommandError)) return json({ error: "INTERNAL_SERVER_ERROR" }, 500);
      const status = error.code === "AUTHENTICATION_REQUIRED" ? 401 : error.code === "INVALID_WISH_START_REQUEST" ? 400
        : error.code === "WISH_NOT_FOUND" ? 404 : error.code === "WISH_START_UNAVAILABLE" ? 503 : 409;
      return json({ error: error.code }, status);
    }
  };
}
function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

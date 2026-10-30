import { cancelDailyItemRequestSchema } from "@reward-planner/schemas";
import type { CancelDailyItemRequest, CancelDailyItemResponse } from "@reward-planner/types";
import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../../../auth/authenticated-request";
import { executeCancelDailyItem, CancelDailyItemCommandError } from "../../../../features/today/cancel-daily-item";
import { createSupabaseCancelDailyItemCommand } from "../../../../features/today/supabase-cancel-daily-item-command";

interface Dependencies {
  authenticate(token: string): Promise<AuthenticatedRequestContext | null>;
  command(context: AuthenticatedRequestContext, input: CancelDailyItemRequest): Promise<CancelDailyItemResponse>;
}
const defaults: Dependencies = {
  authenticate: authenticateAccessToken,
  command: (context, input) => executeCancelDailyItem(input, createSupabaseCancelDailyItemCommand(context.supabase)),
};

export function cancelDailyItemPostHandler(dependencies = defaults) {
  return async (request: Request) => {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
    const input = cancelDailyItemRequestSchema.safeParse(body);
    if (!input.success) return json({ error: "INVALID_REQUEST" }, 400);
    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return json({ error: "UNAUTHORIZED" }, 401);
    try {
      const context = await dependencies.authenticate(token);
      if (!context) return json({ error: "UNAUTHORIZED" }, 401);
      return json(await dependencies.command(context, input.data), 200);
    } catch (error) {
      if (error instanceof CancelDailyItemCommandError) {
        const status = error.code === "AUTHENTICATION_REQUIRED" ? 401
          : ["DAILY_PLAN_NOT_FOUND", "DAILY_ITEM_NOT_FOUND"].includes(error.code) ? 404
          : error.code === "INVALID_CANCEL_REQUEST" ? 400 : 409;
        return json({ error: error.code }, status);
      }
      return json({ error: "INTERNAL_SERVER_ERROR" }, 500);
    }
  };
}
function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

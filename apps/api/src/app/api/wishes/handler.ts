import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../../auth/authenticated-request";
import { bearer } from "../../../features/wish/cover-http";
import { getWishBoard } from "../../../features/wish/get-wish-board";
import type { WishBoardResponse } from "@reward-planner/types";

export function createWishBoardHandler(deps: {
  authenticate: typeof authenticateAccessToken;
  query: (context: AuthenticatedRequestContext, signal: AbortSignal) => Promise<WishBoardResponse>;
} = {
  authenticate: authenticateAccessToken,
  query: (context, signal) => getWishBoard(context.supabase, signal),
}) {
  return async (request: Request) => {
    const headers = { "Cache-Control": "private, no-store" };
    const token = bearer(request);
    if (!token) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
    try {
      const context = await deps.authenticate(token);
      if (!context) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
      return Response.json(await deps.query(context, request.signal), { headers });
    } catch {
      return Response.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500, headers });
    }
  };
}

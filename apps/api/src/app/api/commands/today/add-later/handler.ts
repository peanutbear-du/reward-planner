import { addLaterRequestSchema } from "@reward-planner/schemas";
import type { AddLaterRequest, AddLaterResponse } from "@reward-planner/types";

import {
  authenticateAccessToken,
  type AuthenticatedRequestContext,
} from "../../../../../auth/authenticated-request";
import { AddLaterCommandError, executeAddLater } from "../../../../../features/today/add-later";
import { createSupabaseAddLaterCommand } from "../../../../../features/today/supabase-add-later-command";

interface AddLaterRouteDependencies {
  authenticate(accessToken: string): Promise<AuthenticatedRequestContext | null>;
  command(context: AuthenticatedRequestContext, input: AddLaterRequest): Promise<AddLaterResponse>;
}

export function addLaterPostHandler(
  dependencies: AddLaterRouteDependencies = {
    authenticate: authenticateAccessToken,
    command: (context, input) => executeAddLater(
      input, createSupabaseAddLaterCommand(context.supabase),
    ),
  },
) {
  return async (request: Request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("INVALID_REQUEST", 400);
    }
    const parsed = addLaterRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("INVALID_REQUEST", 400);
    }
    const accessToken = /^Bearer\s+([^\s]+)$/i.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!accessToken) {
      return jsonError("UNAUTHORIZED", 401);
    }
    try {
      const context = await dependencies.authenticate(accessToken);
      if (!context) {
        return jsonError("UNAUTHORIZED", 401);
      }
      return Response.json(await dependencies.command(context, parsed.data), {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      if (error instanceof AddLaterCommandError) {
        return jsonError(error.code, error.status);
      }
      return jsonError("INTERNAL_SERVER_ERROR", 500);
    }
  };
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, {
    status, headers: { "Cache-Control": "private, no-store" },
  });
}

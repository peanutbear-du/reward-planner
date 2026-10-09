import {
  upsertDraftTodayItemRequestSchema,
  removeDraftTodayItemRequestSchema,
} from "@reward-planner/schemas";
import type {
  UpsertDraftTodayItemRequest,
  UpsertDraftTodayItemResponse,
  RemoveDraftTodayItemRequest,
  RemoveDraftTodayItemResponse,
} from "@reward-planner/types";

import {
  authenticateAccessToken,
  type AuthenticatedRequestContext,
} from "../../../../../auth/authenticated-request";
import {
  DraftTodayCommandError,
  executeUpsertDraftTodayItem,
  executeRemoveDraftTodayItem,
} from "../../../../../features/today/draft-today";
import {
  createSupabaseUpsertDraftTodayItemCommand,
  createSupabaseRemoveDraftTodayItemCommand,
} from "../../../../../features/today/supabase-draft-today-command";

interface RouteDependencies<TInput, TResponse> {
  authenticate(accessToken: string): Promise<AuthenticatedRequestContext | null>;
  command(context: AuthenticatedRequestContext, input: TInput): Promise<TResponse>;
}

export function upsertDraftTodayItemPostHandler(
  dependencies: RouteDependencies<UpsertDraftTodayItemRequest, UpsertDraftTodayItemResponse> = {
    authenticate: authenticateAccessToken,
    command: (context, input) => executeUpsertDraftTodayItem(
      input, createSupabaseUpsertDraftTodayItemCommand(context.supabase),
    ),
  },
) {
  return draftPostHandler(upsertDraftTodayItemRequestSchema, dependencies);
}

export function removeDraftTodayItemPostHandler(
  dependencies: RouteDependencies<RemoveDraftTodayItemRequest, RemoveDraftTodayItemResponse> = {
    authenticate: authenticateAccessToken,
    command: (context, input) => executeRemoveDraftTodayItem(
      input, createSupabaseRemoveDraftTodayItemCommand(context.supabase),
    ),
  },
) {
  return draftPostHandler(removeDraftTodayItemRequestSchema, dependencies);
}

interface RequestSchema<TInput> {
  safeParse(value: unknown):
    { success: true; data: TInput } | { success: false };
}

function draftPostHandler<TInput, TResponse>(
  schema: RequestSchema<TInput>,
  dependencies: RouteDependencies<TInput, TResponse>,
) {
  return async (request: Request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("INVALID_REQUEST", 400);
    }
    const parsed = schema.safeParse(body);
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
      if (error instanceof DraftTodayCommandError) {
        return jsonError(error.code, error.status);
      }
      return jsonError("INTERNAL_SERVER_ERROR", 500);
    }
  };
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

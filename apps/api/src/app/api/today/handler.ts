import { todayQuerySchema } from "@reward-planner/schemas";
import type { TodayResponse } from "@reward-planner/types";

import {
  authenticateAccessToken,
  type AuthenticatedRequestContext,
} from "../../../auth/authenticated-request";
import { getToday } from "../../../features/today/get-today";
import { createSupabaseTodayDataSource } from "../../../features/today/supabase-today-data-source";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
};

interface TodayRouteDependencies {
  authenticate(
    accessToken: string,
  ): Promise<AuthenticatedRequestContext | null>;
  query(
    context: AuthenticatedRequestContext,
    date: string,
  ): Promise<TodayResponse>;
}

const defaultDependencies: TodayRouteDependencies = {
  authenticate: authenticateAccessToken,
  query(context, date) {
    return getToday(date, createSupabaseTodayDataSource(context.supabase));
  },
};

export function createTodayGetHandler(
  dependencies: TodayRouteDependencies = defaultDependencies,
) {
  return async function handleTodayGet(request: Request) {
    const requestUrl = new URL(request.url);
    const parsedQuery = todayQuerySchema.safeParse(
      Object.fromEntries(requestUrl.searchParams),
    );

    if (!parsedQuery.success) {
      return jsonError("INVALID_DATE", 400);
    }

    const accessToken = readBearerToken(request.headers.get("authorization"));

    if (!accessToken) {
      return jsonError("UNAUTHORIZED", 401);
    }

    try {
      const context = await dependencies.authenticate(accessToken);

      if (!context) {
        return jsonError("UNAUTHORIZED", 401);
      }

      const response = await dependencies.query(context, parsedQuery.data.date);

      return Response.json(response, {
        headers: privateNoStoreHeaders,
      });
    } catch {
      return jsonError("INTERNAL_SERVER_ERROR", 500);
    }
  };
}

function readBearerToken(value: string | null) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(value ?? "");
  return match?.[1] ?? null;
}

function jsonError(error: string, status: number) {
  return Response.json(
    { error },
    {
      headers: privateNoStoreHeaders,
      status,
    },
  );
}

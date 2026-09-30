import { createTaskRequestSchema } from "@reward-planner/schemas";
import type {
  CreateTaskRequest,
  CreateTaskResponse,
} from "@reward-planner/types";

import {
  authenticateAccessToken,
  type AuthenticatedRequestContext,
} from "../../../../../auth/authenticated-request";
import { executeCreateTask } from "../../../../../features/task/create-task";
import { createSupabaseCreateTaskCommand } from "../../../../../features/task/supabase-create-task-command";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
};

interface CreateTaskRouteDependencies {
  authenticate(
    accessToken: string,
  ): Promise<AuthenticatedRequestContext | null>;
  command(
    context: AuthenticatedRequestContext,
    input: CreateTaskRequest,
  ): Promise<CreateTaskResponse>;
}

const defaultDependencies: CreateTaskRouteDependencies = {
  authenticate: authenticateAccessToken,
  command(context, input) {
    return executeCreateTask(
      input,
      createSupabaseCreateTaskCommand(context.supabase),
    );
  },
};

export function createTaskPostHandler(
  dependencies: CreateTaskRouteDependencies = defaultDependencies,
) {
  return async function handleCreateTaskPost(request: Request) {
    const parsedBody = await parseRequestBody(request);

    if (!parsedBody.success) {
      return jsonError("INVALID_REQUEST", 400);
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

      const response = await dependencies.command(context, parsedBody.data);

      return Response.json(response, {
        headers: privateNoStoreHeaders,
        status: 201,
      });
    } catch {
      return jsonError("INTERNAL_SERVER_ERROR", 500);
    }
  };
}

async function parseRequestBody(request: Request) {
  try {
    return createTaskRequestSchema.safeParse(await request.json());
  } catch {
    return createTaskRequestSchema.safeParse(undefined);
  }
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

import { deleteTaskRequestSchema } from "@reward-planner/schemas";
import type { DeleteTaskRequest, DeleteTaskResponse } from "@reward-planner/types";

import {
  authenticateAccessToken,
  type AuthenticatedRequestContext,
} from "../../../../../auth/authenticated-request";
import { executeDeleteTask } from "../../../../../features/task/delete-task";
import { createSupabaseDeleteTaskCommand } from "../../../../../features/task/supabase-delete-task-command";
import { TaskCommandError } from "../../../../../features/task/task-command-error";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
};

interface DeleteTaskRouteDependencies {
  authenticate(
    accessToken: string,
  ): Promise<AuthenticatedRequestContext | null>;
  command(
    context: AuthenticatedRequestContext,
    input: DeleteTaskRequest,
  ): Promise<DeleteTaskResponse>;
}

const defaultDependencies: DeleteTaskRouteDependencies = {
  authenticate: authenticateAccessToken,
  command(context, input) {
    return executeDeleteTask(
      input,
      createSupabaseDeleteTaskCommand(context.supabase),
    );
  },
};

export function deleteTaskPostHandler(
  dependencies: DeleteTaskRouteDependencies = defaultDependencies,
) {
  return async function handleDeleteTaskPost(request: Request) {
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
        status: 200,
      });
    } catch (error) {
      if (error instanceof TaskCommandError) {
        return error.kind === "not_found"
          ? jsonError("TASK_NOT_FOUND", 404)
          : jsonError("TASK_DELETE_NOT_ALLOWED", 409);
      }

      return jsonError("INTERNAL_SERVER_ERROR", 500);
    }
  };
}

async function parseRequestBody(request: Request) {
  try {
    return deleteTaskRequestSchema.safeParse(await request.json());
  } catch {
    return deleteTaskRequestSchema.safeParse(undefined);
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

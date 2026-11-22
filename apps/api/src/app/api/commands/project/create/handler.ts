import { createProjectRequestSchema } from "@reward-planner/schemas";
import type { CreateProjectErrorCode, CreateProjectRequest, CreateProjectResponse } from "@reward-planner/types";
import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { CreateProjectCommandError, executeCreateProject } from "../../../../../features/project/create-project";
import { createSupabaseCreateProjectCommand } from "../../../../../features/project/supabase-create-project-command";

interface Dependencies {
  authenticate(token: string): Promise<AuthenticatedRequestContext | null>;
  command(context: AuthenticatedRequestContext, input: CreateProjectRequest): Promise<CreateProjectResponse>;
}

const defaults: Dependencies = {
  authenticate: authenticateAccessToken,
  command: (context, input) => executeCreateProject(input, createSupabaseCreateProjectCommand(context.supabase)),
};

const commandErrorStatus: Record<CreateProjectErrorCode, number> = {
  AUTHENTICATION_REQUIRED: 401,
  INVALID_PROJECT_REQUEST: 400,
  PROJECT_CREATION_UNAVAILABLE: 503,
};

export function createProjectPostHandler(dependencies = defaults) {
  return async (request: Request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    const input = createProjectRequestSchema.safeParse(body);
    if (!input.success) return json({ error: "INVALID_REQUEST" }, 400);

    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return json({ error: "UNAUTHORIZED" }, 401);

    try {
      const context = await dependencies.authenticate(token);
      if (!context) return json({ error: "UNAUTHORIZED" }, 401);
      return json(await dependencies.command(context, input.data), 201);
    } catch (error) {
      if (error instanceof CreateProjectCommandError) return json({ error: error.code }, commandErrorStatus[error.code]);
      return json({ error: "INTERNAL_SERVER_ERROR" }, 500);
    }
  };
}

function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

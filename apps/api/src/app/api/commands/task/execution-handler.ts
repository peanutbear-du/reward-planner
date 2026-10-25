import { taskExecutionRequestSchema } from "@reward-planner/schemas";
import type { TaskExecutionRequest, TaskExecutionResponse } from "@reward-planner/types";
import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../../../auth/authenticated-request";
import { executeTaskExecution, TaskExecutionCommandError } from "../../../../features/task/task-execution";
import { createSupabaseTaskExecutionCommand } from "../../../../features/task/supabase-task-execution-command";

interface TaskExecutionRouteDependencies {
  authenticate(accessToken: string): Promise<AuthenticatedRequestContext | null>;
  command(context: AuthenticatedRequestContext, input: TaskExecutionRequest, completed: boolean): Promise<TaskExecutionResponse>;
}

const defaultDependencies: TaskExecutionRouteDependencies = {
  authenticate: authenticateAccessToken,
  command: (context, input, completed) => executeTaskExecution(
    input, completed, createSupabaseTaskExecutionCommand(context.supabase),
  ),
};

export function taskExecutionPostHandler(completed: boolean, dependencies = defaultDependencies) {
  return async (request: Request) => {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
    const input = taskExecutionRequestSchema.safeParse(body);
    if (!input.success) return json({ error: "INVALID_REQUEST" }, 400);
    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return json({ error: "UNAUTHORIZED" }, 401);
    try {
      const context = await dependencies.authenticate(token);
      if (!context) return json({ error: "UNAUTHORIZED" }, 401);
      return json(await dependencies.command(context, input.data, completed), 200);
    } catch (error) {
      if (error instanceof TaskExecutionCommandError) {
        const status = error.code === "AUTHENTICATION_REQUIRED" ? 401
          : ["TASK_NOT_FOUND", "DAILY_PLAN_NOT_FOUND", "DAILY_ITEM_NOT_FOUND"].includes(error.code) ? 404 : 409;
        return json({ error: error.code }, status);
      }
      return json({ error: "INTERNAL_SERVER_ERROR" }, 500);
    }
  };
}

function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

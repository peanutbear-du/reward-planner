import { projectsQuerySchema } from "@reward-planner/schemas";
import type { ProjectsQuery } from "@reward-planner/schemas";
import type { ProjectsResponse } from "@reward-planner/types";

import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../../auth/authenticated-request";
import { getProjects } from "../../../features/project/get-projects";

interface Dependencies {
  authenticate: typeof authenticateAccessToken;
  query(context: AuthenticatedRequestContext, query: ProjectsQuery, signal: AbortSignal): Promise<ProjectsResponse>;
}

const defaults: Dependencies = {
  authenticate: authenticateAccessToken,
  query: (context, query, signal) => getProjects(context.supabase, query, signal),
};

export function createProjectsGetHandler(dependencies: Dependencies = defaults) {
  return async (request: Request) => {
    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return json({ error: "UNAUTHORIZED" }, 401);

    try {
      const context = await dependencies.authenticate(token);
      if (!context) return json({ error: "UNAUTHORIZED" }, 401);

      const params = [...new URL(request.url).searchParams];
      const parsed = projectsQuerySchema.safeParse(Object.fromEntries(params));
      if (!parsed.success || new Set(params.map(([key]) => key)).size !== params.length) {
        return json({ error: "INVALID_QUERY" }, 400);
      }
      return json(await dependencies.query(context, parsed.data, request.signal), 200);
    } catch {
      return json({ error: "INTERNAL_SERVER_ERROR" }, 500);
    }
  };
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

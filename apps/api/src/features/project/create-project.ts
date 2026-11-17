import { createProjectRequestSchema } from "@reward-planner/schemas";
import type { CreateProjectErrorCode, CreateProjectRequest, CreateProjectResponse } from "@reward-planner/types";

export interface CreateProjectCommand {
  execute(input: CreateProjectRequest): Promise<CreateProjectResponse["data"]>;
}

export class CreateProjectCommandError extends Error {
  constructor(readonly code: CreateProjectErrorCode) {
    super(code);
    this.name = "CreateProjectCommandError";
  }
}

export async function executeCreateProject(
  input: CreateProjectRequest,
  command: CreateProjectCommand,
): Promise<CreateProjectResponse> {
  const parsed = createProjectRequestSchema.safeParse(input);
  if (!parsed.success) throw new CreateProjectCommandError("INVALID_PROJECT_REQUEST");

  return { data: await command.execute(parsed.data), effects: ["project_created"] };
}

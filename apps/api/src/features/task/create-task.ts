import type {
  CreateTaskRequest,
  CreateTaskResponse,
} from "@reward-planner/types";

export interface CreateTaskCommand {
  execute(input: CreateTaskRequest): Promise<CreateTaskResponse["data"]>;
}

export async function executeCreateTask(
  input: CreateTaskRequest,
  command: CreateTaskCommand,
): Promise<CreateTaskResponse> {
  return {
    data: await command.execute(input),
    effects: ["task_created"],
  };
}

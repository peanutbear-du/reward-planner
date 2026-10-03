import type { DeleteTaskRequest, DeleteTaskResponse } from "@reward-planner/types";

export interface DeleteTaskCommand {
  execute(input: DeleteTaskRequest): Promise<DeleteTaskResponse["data"]>;
}

export async function executeDeleteTask(
  input: DeleteTaskRequest,
  command: DeleteTaskCommand,
): Promise<DeleteTaskResponse> {
  return {
    data: await command.execute(input),
    effects: ["task_deleted"],
  };
}

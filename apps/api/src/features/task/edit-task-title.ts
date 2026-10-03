import type {
  EditTaskTitleRequest,
  EditTaskTitleResponse,
} from "@reward-planner/types";

export interface EditTaskTitleCommand {
  execute(input: EditTaskTitleRequest): Promise<EditTaskTitleResponse["data"]>;
}

export async function executeEditTaskTitle(
  input: EditTaskTitleRequest,
  command: EditTaskTitleCommand,
): Promise<EditTaskTitleResponse> {
  return {
    data: await command.execute(input),
    effects: ["task_updated"],
  };
}

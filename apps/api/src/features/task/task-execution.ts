import type { TaskExecutionData, TaskExecutionErrorCode, TaskExecutionRequest, TaskExecutionResponse } from "@reward-planner/types";

export class TaskExecutionCommandError extends Error {
  constructor(readonly code: TaskExecutionErrorCode) {
    super(code);
    this.name = "TaskExecutionCommandError";
  }
}

export interface TaskExecutionCommand {
  execute(input: TaskExecutionRequest, completed: boolean): Promise<TaskExecutionData>;
}

export async function executeTaskExecution(
  input: TaskExecutionRequest, completed: boolean, command: TaskExecutionCommand,
): Promise<TaskExecutionResponse> {
  const data = await command.execute(input, completed);
  return {
    data,
    effects: data.changed ? [completed ? "task_completed" : "task_uncompleted"] : [],
  };
}

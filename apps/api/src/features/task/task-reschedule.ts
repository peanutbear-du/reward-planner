import type { TaskRescheduleData, TaskRescheduleErrorCode, TaskRescheduleRequest, TaskRescheduleResponse } from "@reward-planner/types";

export class TaskRescheduleCommandError extends Error {
  constructor(readonly code: TaskRescheduleErrorCode) {
    super(code);
    this.name = "TaskRescheduleCommandError";
  }
}

export interface TaskRescheduleCommand {
  execute(input: TaskRescheduleRequest): Promise<TaskRescheduleData>;
}

export async function executeTaskReschedule(input: TaskRescheduleRequest, command: TaskRescheduleCommand): Promise<TaskRescheduleResponse> {
  const data = await command.execute(input);
  return { data, effects: data.changed ? ["task_rescheduled"] : [] };
}

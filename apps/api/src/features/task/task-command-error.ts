export type TaskCommandErrorKind = "not_found" | "conflict";

export class TaskCommandError extends Error {
  readonly kind: TaskCommandErrorKind;

  constructor(kind: TaskCommandErrorKind) {
    super(kind === "not_found" ? "Task not found." : "Task command not allowed.");
    this.name = "TaskCommandError";
    this.kind = kind;
  }
}

export function throwTaskRpcError(
  error: unknown,
  conflictCode: string,
  operation: string,
): never {
  const message = getErrorMessage(error);

  if (message === "TASK_NOT_FOUND") {
    throw new TaskCommandError("not_found");
  }

  if (message === conflictCode) {
    throw new TaskCommandError("conflict");
  }

  throw new Error(`Failed to execute the ${operation} command.`, { cause: error });
}

function getErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return null;
}

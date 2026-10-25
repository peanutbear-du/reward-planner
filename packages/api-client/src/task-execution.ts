import type { TaskExecutionRequest, TaskExecutionResponse } from "@reward-planner/types";

export interface TaskExecutionOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: TaskExecutionRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class TaskExecutionApiClientError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`Task execution request failed with status ${status}.`);
    this.name = "TaskExecutionApiClientError";
  }
}

export const completeTask = (options: TaskExecutionOptions) => postExecution("complete", options);
export const uncompleteTask = (options: TaskExecutionOptions) => postExecution("uncomplete", options);

async function postExecution(
  action: "complete" | "uncomplete",
  { apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch }: TaskExecutionOptions,
): Promise<TaskExecutionResponse> {
  const response = await fetchImplementation(new URL(`/api/commands/task/${action}`, apiBaseUrl), {
    method: "POST", cache: "no-store", signal,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let code: string | null = null;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") code = body.error;
    } catch { /* A transport error need not return JSON. */ }
    throw new TaskExecutionApiClientError(response.status, code);
  }
  return await response.json() as TaskExecutionResponse;
}

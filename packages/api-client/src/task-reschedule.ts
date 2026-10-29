import type { TaskRescheduleRequest, TaskRescheduleResponse } from "@reward-planner/types";

export interface TaskRescheduleOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: TaskRescheduleRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class TaskRescheduleApiClientError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`Task reschedule request failed with status ${status}.`);
    this.name = "TaskRescheduleApiClientError";
  }
}

export async function rescheduleTask({ apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch }: TaskRescheduleOptions): Promise<TaskRescheduleResponse> {
  const response = await fetchImplementation(new URL("/api/commands/task/reschedule", apiBaseUrl), {
    method: "POST", cache: "no-store", signal,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let code: string | null = null;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") code = body.error;
    } catch { /* Transport failures may not return JSON. */ }
    throw new TaskRescheduleApiClientError(response.status, code);
  }
  return await response.json() as TaskRescheduleResponse;
}

import type {
  CreateTaskRequest,
  CreateTaskResponse,
} from "@reward-planner/types";

export interface CreateTaskOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: CreateTaskRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class CreateTaskApiClientError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Create Task request failed with status ${status}.`);
    this.name = "CreateTaskApiClientError";
    this.status = status;
  }
}

export async function createTask({
  apiBaseUrl,
  accessToken,
  input,
  signal,
  fetchImplementation = fetch,
}: CreateTaskOptions): Promise<CreateTaskResponse> {
  const requestUrl = new URL(
    "/api/commands/task/create",
    ensureTrailingSlash(apiBaseUrl),
  );
  const response = await fetchImplementation(requestUrl, {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new CreateTaskApiClientError(response.status);
  }

  return (await response.json()) as CreateTaskResponse;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

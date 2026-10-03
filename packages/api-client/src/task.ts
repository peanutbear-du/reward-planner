import type {
  CreateTaskRequest,
  CreateTaskResponse,
  DeleteTaskRequest,
  DeleteTaskResponse,
  EditTaskTitleRequest,
  EditTaskTitleResponse,
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

export interface EditTaskTitleOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: EditTaskTitleRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class EditTaskTitleApiClientError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Edit Task request failed with status ${status}.`);
    this.name = "EditTaskTitleApiClientError";
    this.status = status;
  }
}

export async function editTaskTitle({
  apiBaseUrl,
  accessToken,
  input,
  signal,
  fetchImplementation = fetch,
}: EditTaskTitleOptions): Promise<EditTaskTitleResponse> {
  return postTaskCommand({
    accessToken,
    apiBaseUrl,
    error: (status) => new EditTaskTitleApiClientError(status),
    fetchImplementation,
    input,
    path: "/api/commands/task/edit",
    signal,
  });
}

export interface DeleteTaskOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: DeleteTaskRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class DeleteTaskApiClientError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Delete Task request failed with status ${status}.`);
    this.name = "DeleteTaskApiClientError";
    this.status = status;
  }
}

export async function deleteTask({
  apiBaseUrl,
  accessToken,
  input,
  signal,
  fetchImplementation = fetch,
}: DeleteTaskOptions): Promise<DeleteTaskResponse> {
  return postTaskCommand({
    accessToken,
    apiBaseUrl,
    error: (status) => new DeleteTaskApiClientError(status),
    fetchImplementation,
    input,
    path: "/api/commands/task/delete",
    signal,
  });
}

interface PostTaskCommandOptions<TRequest> {
  apiBaseUrl: string;
  accessToken: string;
  input: TRequest;
  path: string;
  signal?: AbortSignal;
  fetchImplementation: typeof fetch;
  error(status: number): Error;
}

async function postTaskCommand<TRequest, TResponse>({
  apiBaseUrl,
  accessToken,
  input,
  path,
  signal,
  fetchImplementation,
  error,
}: PostTaskCommandOptions<TRequest>): Promise<TResponse> {
  const requestUrl = new URL(path, ensureTrailingSlash(apiBaseUrl));
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
    throw error(response.status);
  }

  return (await response.json()) as TResponse;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

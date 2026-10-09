import type {
  UpsertDraftTodayItemRequest,
  UpsertDraftTodayItemResponse,
  RemoveDraftTodayItemRequest,
  RemoveDraftTodayItemResponse,
} from "@reward-planner/types";

export interface DraftTodayCommandOptions<TInput> {
  apiBaseUrl: string;
  accessToken: string;
  input: TInput;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class DraftTodayApiClientError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Draft Today request failed with status ${status}.`);
    this.name = "DraftTodayApiClientError";
    this.status = status;
  }
}

export function upsertDraftTodayItem(
  options: DraftTodayCommandOptions<UpsertDraftTodayItemRequest>,
): Promise<UpsertDraftTodayItemResponse> {
  return postDraftCommand("upsert-item", options);
}

export function removeDraftTodayItem(
  options: DraftTodayCommandOptions<RemoveDraftTodayItemRequest>,
): Promise<RemoveDraftTodayItemResponse> {
  return postDraftCommand("remove-item", options);
}

async function postDraftCommand<TInput, TResponse>(
  command: "upsert-item" | "remove-item",
  { apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch }:
    DraftTodayCommandOptions<TInput>,
): Promise<TResponse> {
  const response = await fetchImplementation(
    new URL(`/api/commands/today/draft/${command}`, apiBaseUrl),
    {
      method: "POST",
      body: JSON.stringify(input),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      signal,
    },
  );

  if (!response.ok) {
    throw new DraftTodayApiClientError(response.status);
  }

  return await response.json() as TResponse;
}

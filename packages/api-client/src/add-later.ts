import type { AddLaterRequest, AddLaterResponse } from "@reward-planner/types";

export interface AddLaterOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: AddLaterRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class AddLaterApiClientError extends Error {
  constructor(readonly status: number) {
    super(`Added Later request failed with status ${status}.`);
    this.name = "AddLaterApiClientError";
  }
}

export async function addLater({
  apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch,
}: AddLaterOptions): Promise<AddLaterResponse> {
  const response = await fetchImplementation(
    new URL("/api/commands/today/add-later", apiBaseUrl),
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
    throw new AddLaterApiClientError(response.status);
  }
  return await response.json() as AddLaterResponse;
}

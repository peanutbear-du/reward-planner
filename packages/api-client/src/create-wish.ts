import type { CreateWishRequest, CreateWishResponse } from "@reward-planner/types";

export interface CreateWishOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: CreateWishRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}
export class CreateWishApiClientError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`Create Wish request failed with status ${status}.`); this.name = "CreateWishApiClientError";
  }
}
export async function createWish({ apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch }: CreateWishOptions): Promise<CreateWishResponse> {
  // Creation is not automatically retried: a lost response may already be committed.
  const response = await fetchImplementation(new URL("/api/commands/wish/create", apiBaseUrl), {
    method: "POST", cache: "no-store", signal,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let code: string | null = null;
    try { const body: unknown = await response.json(); if (body && typeof body === "object" && "error" in body && typeof body.error === "string") code = body.error; } catch { /* Non-JSON error responses are valid transport failures. */ }
    throw new CreateWishApiClientError(response.status, code);
  }
  return await response.json() as CreateWishResponse;
}

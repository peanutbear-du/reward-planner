import type { StartWishRequest, StartWishResponse } from "@reward-planner/types";

export interface StartWishOptions {
  apiBaseUrl: string; accessToken: string; input: StartWishRequest;
  signal?: AbortSignal; fetchImplementation?: typeof fetch;
}
export class StartWishApiClientError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`Wish lifecycle request failed: ${status}`); this.name = "StartWishApiClientError";
  }
}
async function command(mode: "start" | "switch", { apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch }: StartWishOptions): Promise<StartWishResponse> {
  // State idempotency only. A lost response is never automatically replayed.
  const response = await fetchImplementation(new URL(`/api/commands/wish/${mode}`, apiBaseUrl), {
    method: "POST", cache: "no-store", signal,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let code: string | null = null;
    try { const body = await response.json(); if (typeof body?.error === "string") code = body.error; } catch { /* Non-JSON failure. */ }
    throw new StartWishApiClientError(response.status, code);
  }
  return await response.json() as StartWishResponse;
}
export const startWish = (options: StartWishOptions) => command("start", options);
export const switchWish = (options: StartWishOptions) => command("switch", options);

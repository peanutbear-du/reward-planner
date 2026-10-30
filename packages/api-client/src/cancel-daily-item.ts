import type { CancelDailyItemRequest, CancelDailyItemResponse } from "@reward-planner/types";

export interface CancelDailyItemOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: CancelDailyItemRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class CancelDailyItemApiClientError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`Cancel Daily Item request failed with status ${status}.`);
    this.name = "CancelDailyItemApiClientError";
  }
}

export async function cancelDailyItem({ apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch }: CancelDailyItemOptions): Promise<CancelDailyItemResponse> {
  const response = await fetchImplementation(new URL("/api/commands/daily-item/cancel", apiBaseUrl), {
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
    throw new CancelDailyItemApiClientError(response.status, code);
  }
  return await response.json() as CancelDailyItemResponse;
}

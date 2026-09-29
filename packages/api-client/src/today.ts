import type { TodayResponse } from "@reward-planner/types";

export interface GetTodayOptions {
  apiBaseUrl: string;
  accessToken: string;
  date: string;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class ApiClientError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Today request failed with status ${status}.`);
    this.name = "ApiClientError";
    this.status = status;
  }
}

export async function getToday({
  apiBaseUrl,
  accessToken,
  date,
  signal,
  fetchImplementation = fetch,
}: GetTodayOptions): Promise<TodayResponse> {
  const requestUrl = new URL("/api/today", ensureTrailingSlash(apiBaseUrl));
  requestUrl.searchParams.set("date", date);

  const response = await fetchImplementation(requestUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    signal,
  });

  if (!response.ok) {
    throw new ApiClientError(response.status);
  }

  return (await response.json()) as TodayResponse;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

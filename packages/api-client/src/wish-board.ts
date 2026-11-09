import type { WishBoardResponse } from "@reward-planner/types";

export async function getWishBoard({ apiBaseUrl, accessToken, signal, fetchImplementation = fetch }: {
  apiBaseUrl: string;
  accessToken: string;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}): Promise<WishBoardResponse> {
  const response = await fetchImplementation(new URL("/api/wishes", apiBaseUrl), {
    method: "GET",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw Object.assign(new Error("Wish Board request failed."), { status: response.status });
  return await response.json() as WishBoardResponse;
}

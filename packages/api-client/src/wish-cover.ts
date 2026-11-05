import type { UploadWishCoverResponse, WishCoverUrlResponse, WishCoverCleanup } from "@reward-planner/types";

interface Options { apiBaseUrl: string; accessToken: string; wishId: string; signal?: AbortSignal; fetchImplementation?: typeof fetch }
export class WishCoverApiClientError extends Error {
  constructor(readonly status: number, readonly code: string | null, readonly cleanup: WishCoverCleanup | null) { super(`Wish Cover request failed: ${status}`); this.name = "WishCoverApiClientError"; }
}
async function result<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let code: string | null = null, cleanup: WishCoverCleanup | null = null;
    try { const b = await r.json(); if (typeof b.error === "string") code = b.error; if (["removed", "not_required", "unconfirmed"].includes(b.cleanup)) cleanup = b.cleanup; } catch { /* Non-JSON failure */ }
    throw new WishCoverApiClientError(r.status, code, cleanup);
  }
  return await r.json() as T;
}
export async function uploadWishCover({ apiBaseUrl, accessToken, wishId, file, signal, fetchImplementation = fetch }: Options & { file: Blob }): Promise<UploadWishCoverResponse> {
  const body = new FormData(); body.set("wishId", wishId); body.set("file", file, "cover.jpg");
  return result(await fetchImplementation(new URL("/api/commands/wish/cover-upload", apiBaseUrl), { method: "POST", body, signal, cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } }));
}
export async function getWishCoverUrl({ apiBaseUrl, accessToken, wishId, signal, fetchImplementation = fetch }: Options): Promise<WishCoverUrlResponse> {
  const url = new URL("/api/wishes/cover", apiBaseUrl); url.searchParams.set("wishId", wishId);
  return result(await fetchImplementation(url, { method: "GET", signal, cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } }));
}

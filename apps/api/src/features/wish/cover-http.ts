import { WishCoverError, MAX_COVER_BYTES } from "./wish-cover";

export function coverJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function coverFailure(error: unknown) {
  if (!(error instanceof WishCoverError)) return coverJson({ error: "INTERNAL_SERVER_ERROR" }, 500);
  const status = error.code === "UNAUTHORIZED" ? 401 : error.code === "FILE_TOO_LARGE" ? 413
    : ["INVALID_REQUEST", "INVALID_JPEG"].includes(error.code) ? 400
    : ["WISH_NOT_FOUND", "COVER_NOT_FOUND"].includes(error.code) ? 404
    : ["WISH_COVER_EXISTS", "COVER_UPLOAD_CONFLICT"].includes(error.code) ? 409 : 502;
  return coverJson({ error: error.code, cleanup: error.cleanup }, status);
}
export function bearer(request: Request) { return /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]; }

// Bound actual bytes before multipart parsing, including requests without Length.
export async function coverForm(request: Request): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "", cap = MAX_COVER_BYTES + 65536;
  if (!/^multipart\/form-data\s*;/i.test(type) || !request.body) throw new WishCoverError("INVALID_REQUEST");
  const length = request.headers.get("content-length");
  if (length && Number(length) > cap) throw new WishCoverError("FILE_TOO_LARGE");
  const reader = request.body.getReader(), bytes = new Uint8Array(cap);
  let count = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      count += part.value.byteLength;
      if (count > cap) { await reader.cancel(); throw new WishCoverError("FILE_TOO_LARGE"); }
      bytes.set(part.value, count - part.value.byteLength);
    }
    return await new Request(request.url, { method: "POST", headers: { "Content-Type": type }, body: bytes.slice(0, count) }).formData();
  } catch (e) { if (e instanceof WishCoverError) throw e; throw new WishCoverError("INVALID_REQUEST"); }
  finally { reader.releaseLock(); }
}

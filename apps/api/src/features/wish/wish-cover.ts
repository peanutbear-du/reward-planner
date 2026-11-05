import type { UploadWishCoverResponse, WishCoverCleanup, WishCoverErrorCode, WishCoverUrlResponse } from "@reward-planner/types";

export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export interface OwnedWish { id: string; userId: string; coverPath: string | null }
export interface CoverReader {
  wish(id: string): Promise<OwnedWish | null>;
  signedUrl(path: string): Promise<string>;
}
export interface CoverWriter {
  upload(path: string, bytes: Uint8Array): Promise<void>;
  attach(wish: OwnedWish): Promise<void>;
  remove(path: string): Promise<void>;
}
export class WishCoverError extends Error {
  constructor(readonly code: WishCoverErrorCode, readonly cleanup: WishCoverCleanup = "not_required") { super(code); this.name = "WishCoverError"; }
}
export class StorageUploadError extends Error {
  constructor(readonly definite: boolean, readonly conflict = false) { super("Cover upload failed"); }
}
export class CoverLinkError extends Error {
  constructor(readonly definite: boolean) { super("Cover association failed"); }
}
export type CoverAudit = (event: { event: "wish_cover_cleanup_unconfirmed"; wishId: string; coverPath: string; stage: "upload" | "association" }) => void;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function owned(reader: CoverReader, id: string) {
  const w = await reader.wish(id);
  if (!w) throw new WishCoverError("WISH_NOT_FOUND");
  if (w.id !== id || !uuid.test(w.userId)) throw Error("Invalid owned Wish result");
  return w;
}
export function validateCover(bytes: Uint8Array, mimeType: string) {
  if (bytes.byteLength > MAX_COVER_BYTES) throw new WishCoverError("FILE_TOO_LARGE");
  // Signature sniffing, not a decoder: SOI/marker prefix and final EOI required.
  if (mimeType !== "image/jpeg" || bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
    || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new WishCoverError("INVALID_JPEG");
}
export async function uploadWishCover(input: { wishId: string; bytes: Uint8Array; mimeType: string }, reader: CoverReader,
  writerFactory: () => CoverWriter, audit: CoverAudit): Promise<UploadWishCoverResponse> {
  validateCover(input.bytes, input.mimeType);
  const w = await owned(reader, input.wishId);
  if (w.coverPath !== null) throw new WishCoverError("WISH_COVER_EXISTS");
  const path = `${w.userId}/${w.id}.jpg`, writer = writerFactory();
  const success = (): UploadWishCoverResponse => ({ data: { wishId: w.id, coverPath: path }, effects: ["wish_cover_uploaded"] });
  const unconfirmed = (stage: "upload" | "association"): never => {
    audit({ event: "wish_cover_cleanup_unconfirmed", wishId: w.id, coverPath: path, stage });
    throw new WishCoverError("COVER_CLEANUP_UNCONFIRMED", "unconfirmed");
  };
  try { await writer.upload(path, input.bytes); } catch (error) {
    if (error instanceof StorageUploadError && error.definite) {
      throw new WishCoverError(error.conflict ? "COVER_UPLOAD_CONFLICT" : "COVER_UPLOAD_FAILED");
    }
    // Unknown upload outcome: never delete an object whose creation is unproven.
    return unconfirmed("upload");
  }
  try { await writer.attach(w); return success(); } catch (error) {
    // A lost RPC response may have committed. Never erase a referenced cover.
    let actual: OwnedWish | null;
    try { actual = await reader.wish(w.id); } catch { return unconfirmed("association"); }
    if (actual?.coverPath === path) return success();
    if (!(error instanceof CoverLinkError) || !error.definite) return unconfirmed("association");
    // Only this successful non-upsert upload may compensate a confirmed reject.
    // Other ordinary callers cannot attach via RPC, or upload over this object.
    try { await writer.remove(path); } catch { return unconfirmed("association"); }
    throw new WishCoverError("COVER_LINK_FAILED", "removed");
  }
}
export async function getWishCoverUrl(id: string, reader: CoverReader): Promise<WishCoverUrlResponse> {
  const w = await owned(reader, id), path = `${w.userId}/${w.id}.jpg`;
  if (w.coverPath === null) throw new WishCoverError("COVER_NOT_FOUND");
  if (w.coverPath !== path) throw new WishCoverError("COVER_READ_FAILED");
  try { return { data: { wishId: id, signedUrl: await reader.signedUrl(path), expiresIn: 300 } }; }
  catch { throw new WishCoverError("COVER_READ_FAILED"); }
}

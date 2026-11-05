export interface WishCoverRequest { wishId: string }
export interface UploadWishCoverResponse {
  data: { wishId: string; coverPath: string };
  effects: ["wish_cover_uploaded"];
}
export interface WishCoverUrlResponse {
  data: { wishId: string; signedUrl: string; expiresIn: 300 };
}
export type WishCoverCleanup = "removed" | "not_required" | "unconfirmed";
export type WishCoverErrorCode = "INVALID_REQUEST" | "UNAUTHORIZED" | "FILE_TOO_LARGE" | "INVALID_JPEG"
  | "WISH_NOT_FOUND" | "WISH_COVER_EXISTS" | "COVER_UPLOAD_CONFLICT" | "COVER_UPLOAD_FAILED"
  | "COVER_LINK_FAILED" | "COVER_CLEANUP_UNCONFIRMED" | "COVER_NOT_FOUND" | "COVER_READ_FAILED";

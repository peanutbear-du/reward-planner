export interface StartWishRequest { wishId: string }
export type WishLifecycleStatus = "wishlist" | "unlocking" | "unlocked" | "redeemed";
export interface WishLifecycleDto {
  id: string; title: string; target: number; status: WishLifecycleStatus;
  coverPath: string | null; startedAt: string | null; unlockedAt: string | null;
  redeemedAt: string | null; updatedAt: string; progress: number;
}
export type StartWishEffect = "wish_started" | "wish_resumed" | "wish_switched"
  | "pending_progress_applied" | "wish_progress_changed" | "wish_unlocked";
export interface StartWishResponse {
  data: {
    changed: boolean; wish: WishLifecycleDto; previousWish: WishLifecycleDto | null;
    currentWishId: string | null; pendingApplied: number;
    /** Decimal integer string: owner-wide totals may exceed JS safe integers. */
    pendingRemaining: string;
  };
  effects: StartWishEffect[];
}
export type StartWishErrorCode = "AUTHENTICATION_REQUIRED" | "INVALID_WISH_START_REQUEST"
  | "WISH_NOT_FOUND" | "WISH_ALREADY_UNLOCKING" | "WISH_NOT_UNLOCKING"
  | "WISH_START_NOT_ALLOWED" | "REWARD_ALLOCATION_INCONSISTENT" | "WISH_START_UNAVAILABLE";

export interface CreateWishRequest {
  title: string;
  target: number;
  referencePrice?: number | null;
  why?: string | null;
}

export interface CreatedWishDto {
  id: string;
  title: string;
  target: number;
  status: "wishlist";
  coverPath: null;
  startedAt: null;
  unlockedAt: null;
  redeemedAt: null;
  referencePrice: number | null;
  why: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWishResponse {
  data: { wish: CreatedWishDto };
  effects: ["wish_created"];
}

export type CreateWishErrorCode = "AUTHENTICATION_REQUIRED" | "INVALID_WISH_REQUEST" | "WISH_CREATION_UNAVAILABLE";

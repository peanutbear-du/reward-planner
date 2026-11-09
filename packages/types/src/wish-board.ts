import type { WishLifecycleStatus } from "./start-wish";

export interface WishBoardWish {
  id: string;
  title: string;
  target: number;
  progress: number;
  status: WishLifecycleStatus;
  why: string | null;
  hasCover: boolean;
  startedAt: string | null;
  unlockedAt: string | null;
  redeemedAt: string | null;
}

export interface WishBoardResponse {
  wishes: WishBoardWish[];
  recentDailyRewards: {
    id: string;
    amount: number;
    createdAt: string;
    destinations?: ({ kind: "wish"; title: string } | { kind: "pending" })[];
  }[];
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WishBoardResponse, WishLifecycleStatus } from "@reward-planner/types";

interface WishRow {
  id: string;
  title: string;
  target: number;
  status: WishLifecycleStatus;
  why: string | null;
  cover_path: string | null;
  started_at: string | null;
  unlocked_at: string | null;
  redeemed_at: string | null;
  updated_at: string;
}

interface AllocationRow {
  id: string;
  reward_event_id: string;
  wish_id: string | null;
  amount: number;
}

const pageSize = 250;

async function readPages<T extends { id: string }>(
  read: (cursor: string | undefined) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  while (true) {
    const { data, error } = await read(cursor);
    if (error || !data) throw new Error("Could not read Wish Board rows.");
    const last = data.at(-1);
    if (!last) return rows;
    rows.push(...data);
    cursor = last.id;
  }
}

/** The caller supplies the authenticated, RLS-scoped client. */
export async function getWishBoard(supabase: SupabaseClient, signal: AbortSignal): Promise<WishBoardResponse> {
  const [wishes, allocations, rewards] = await Promise.all([
    readPages<WishRow>(cursor => {
      const query = supabase.from("wishes")
        .select("id,title,target,status,why,cover_path,started_at,unlocked_at,redeemed_at,updated_at")
        .order("id").limit(pageSize).abortSignal(signal);
      return (cursor ? query.gt("id", cursor) : query).returns<WishRow[]>();
    }),
    readPages<AllocationRow>(cursor => {
      const query = supabase.from("reward_allocations").select("id,reward_event_id,wish_id,amount")
        .order("id").limit(pageSize).abortSignal(signal);
      return (cursor ? query.gt("id", cursor) : query).returns<AllocationRow[]>();
    }),
    supabase.from("reward_events").select("id,amount,created_at")
      .eq("source_type", "DAILY_QUALIFIED").eq("status", "active")
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(3).abortSignal(signal).returns<{ id: string; amount: number; created_at: string }[]>(),
  ]);
  if (rewards.error || !rewards.data) throw new Error("Could not read recent rewards.");

  const progress = new Map<string, number>();
  const recentAllocations = new Map(rewards.data.map(reward => [reward.id, new Map<string | null, number>()]));
  for (const row of allocations) {
    // Protected terminal allocations remain part of progress after reversal.
    if (row.wish_id !== null) {
      progress.set(row.wish_id, (progress.get(row.wish_id) ?? 0) + row.amount);
    }
    const perDestination = recentAllocations.get(row.reward_event_id);
    perDestination?.set(row.wish_id, (perDestination.get(row.wish_id) ?? 0) + row.amount);
  }
  const wishTitles = new Map(wishes.map(wish => [wish.id, wish.title]));
  return {
    wishes: wishes.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id))
      .map(wish => ({
        id: wish.id, title: wish.title, target: wish.target, status: wish.status, why: wish.why,
        hasCover: wish.cover_path !== null, startedAt: wish.started_at, unlockedAt: wish.unlocked_at,
        redeemedAt: wish.redeemed_at, progress: progress.get(wish.id) ?? 0,
      })),
    recentDailyRewards: rewards.data.map(row => {
      const destinations: NonNullable<WishBoardResponse["recentDailyRewards"][number]["destinations"]> = [];
      for (const [wishId, amount] of recentAllocations.get(row.id) ?? []) {
        if (amount <= 0) continue;
        if (wishId === null) destinations.push({ kind: "pending" });
        else {
          const title = wishTitles.get(wishId);
          if (title !== undefined) destinations.push({ kind: "wish", title });
        }
      }
      return { id: row.id, amount: row.amount, createdAt: row.created_at,
        ...(destinations.length ? { destinations } : {}) };
    }),
  };
}

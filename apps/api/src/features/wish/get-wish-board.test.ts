import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createWishBoardHandler } from "../../app/api/wishes/handler";
import { getWishBoard } from "./get-wish-board";

describe("Wish Board query", () => {
  it("requires a verified session before reading and sends no-store", async () => {
    const authenticate = vi.fn().mockResolvedValue(null);
    const query = vi.fn();
    const handler = createWishBoardHandler({ authenticate, query });
    const anonymous = await handler(new Request("http://localhost/api/wishes"));
    expect(anonymous.status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    const rejected = await handler(new Request("http://localhost/api/wishes", {
      headers: { Authorization: "Bearer invalid" },
    }));
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("cache-control")).toBe("private, no-store");
    expect(query).not.toHaveBeenCalled();
  });

  it("reads every page, keeps signed corrections and terminal credits, and limits Daily history", async () => {
    const now = "2026-11-08T12:00:00Z";
    const base = { title: "Wish", target: 3, why: null, cover_path: null, started_at: now,
      unlocked_at: null, redeemed_at: null, updated_at: now };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-user");
      const id = url.searchParams.get("id");
      if (url.pathname.endsWith("/wishes")) {
        if (!id) return Response.json([{ ...base, id: "a", status: "unlocking" }]);
        if (id === "gt.a") return Response.json([{ ...base, id: "b", title: "Completed Wish", status: "unlocked" }]);
        return Response.json([]);
      }
      if (url.pathname.endsWith("/reward_allocations")) {
        if (!id) return Response.json([{ id: "01", reward_event_id: "recent", wish_id: "a", amount: 1 }]);
        if (id === "gt.01") return Response.json([
          { id: "02", reward_event_id: "recent", wish_id: "a", amount: -1 },
          { id: "03", reward_event_id: "recent", wish_id: "b", amount: 1 },
          { id: "04", reward_event_id: "older", wish_id: "b", amount: 2 },
          { id: "05", reward_event_id: "waiting", wish_id: null, amount: 1 },
        ]);
        return Response.json([]);
      }
      expect(url.pathname).toBe("/rest/v1/reward_events");
      expect(url.searchParams.get("source_type")).toBe("eq.DAILY_QUALIFIED");
      expect(url.searchParams.get("status")).toBe("eq.active");
      expect(url.searchParams.get("limit")).toBe("3");
      return Response.json(["recent", "waiting", "unrecorded"].map(id => ({ id, amount: 1, created_at: now })));
    };
    const client = createClient("http://localhost:54321", "fixture", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: "Bearer test-user" }, fetch: fetcher },
    });
    const handler = createWishBoardHandler({
      authenticate: async () => ({ supabase: client }),
      query: (context, signal) => getWishBoard(context.supabase, signal),
    });
    const response = await handler(new Request("http://localhost/api/wishes", {
      headers: { Authorization: "Bearer test-user" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const board = await response.json();
    expect(board.wishes.map((wish: { progress: number }) => wish.progress)).toEqual([0, 3]);
    expect(board.recentDailyRewards).toEqual([
      { id: "recent", amount: 1, createdAt: now, destinations: [{ kind: "wish", title: "Completed Wish" }] },
      { id: "waiting", amount: 1, createdAt: now, destinations: [{ kind: "pending" }] },
      { id: "unrecorded", amount: 1, createdAt: now },
    ]);
  });
});

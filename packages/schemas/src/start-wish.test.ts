import { describe, expect, it } from "vitest";
import { startWishRequestSchema, startWishResponseSchema } from "./start-wish";
import { createdWishSchema } from "./create-wish";

const id = "70000000-0000-4000-8000-000000000ABC";
const wish = { id: id.toLowerCase(), title: "Camera", target: 60, progress: 0, status: "unlocking", coverPath: null,
  startedAt: "2026-11-06T00:00:00Z", unlockedAt: null, redeemedAt: null, updatedAt: "2026-11-06T00:00:00Z" };
const response = { data: { changed: true, wish, previousWish: null, currentWishId: wish.id, pendingApplied: 0, pendingRemaining: "9007199254740993" }, effects: ["wish_started"] };
describe("Wish lifecycle contracts", () => {
  it("normalizes only UUID identity and retains exact owner-wide integer totals", () => {
    expect(startWishRequestSchema.parse({ wishId: id })).toEqual({ wishId: wish.id });
    expect(startWishResponseSchema.parse(response).data.pendingRemaining).toBe("9007199254740993");
  });
  it.each([{}, { wishId: "../path" }, ...["userId", "amount", "progress", "status", "startedAt", "requestId"].map(key => ({ wishId: id, [key]: "forged" }))])("rejects forged request %#", value => {
    expect(startWishRequestSchema.safeParse(value).success).toBe(false);
  });
  it("accepts a true no-op and a transactional unlock", () => {
    expect(startWishResponseSchema.safeParse({ ...response, data: { ...response.data, changed: false }, effects: [] }).success).toBe(true);
    expect(startWishResponseSchema.safeParse({ data: { ...response.data, wish: { ...wish, status: "unlocked", progress: 60, unlockedAt: wish.startedAt },
      currentWishId: null, pendingApplied: 60 }, effects: ["wish_started", "pending_progress_applied", "wish_progress_changed", "wish_unlocked"] }).success).toBe(true);
  });
  it.each([
    { ...response, effects: [] }, { ...response, effects: ["wish_started", "wish_started"] },
    { ...response, data: { ...response.data, currentWishId: null } },
    { ...response, data: { ...response.data, pendingRemaining: "-1" } },
    { ...response, data: { ...response.data, pendingRemaining: 1 } },
    { ...response, data: { ...response.data, wish: { ...wish, progress: 61 } } },
    { ...response, data: { ...response.data, wish: { ...wish, progress: -1 } } },
    { ...response, data: { ...response.data, changed: false } },
    { ...response, data: { ...response.data, pendingApplied: 1 } },
    { ...response, data: { ...response.data, previousWish: wish } },
  ])("rejects inconsistent persisted response %#", value => expect(startWishResponseSchema.safeParse(value).success).toBe(false));
  it("does not widen the existing Create Wish contract", () => expect(createdWishSchema.safeParse(wish).success).toBe(false));
});

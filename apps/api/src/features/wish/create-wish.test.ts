import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { executeCreateWish } from "./create-wish";
import { createSupabaseCreateWishCommand } from "./supabase-create-wish-command";

const input = { title: "Camera", target: 137, referencePrice: null, why: null };
const wish = { ...input, id: randomUUID(), status: "wishlist" as const, coverPath: null, startedAt: null, unlockedAt: null, redeemedAt: null,
  createdAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z" };
const adapter = (rpc: unknown) => createSupabaseCreateWishCommand({ rpc } as SupabaseClient);
describe("Create Wish service / Supabase contract (mock only)", () => {
  it("calls exactly one user-scoped RPC and returns only wish_created", async () => {
    const rpc = vi.fn(async () => ({ data: { wish: { ...wish, userId: "private" } }, error: null }));
    const result = await executeCreateWish({ title: " Camera ", target: 137 }, adapter(rpc));
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_wish", { p_title: "Camera", p_target: 137, p_reference_price: null, p_why: null });
    expect(result).toEqual({ data: { wish }, effects: ["wish_created"] });
  });
  it("normalizes metadata in service before dispatch", async () => {
    const command = { execute: vi.fn(async () => ({ wish: { ...wish, why: "Photography", referencePrice: 10 } })) };
    await executeCreateWish({ ...input, referencePrice: 10, why: " Photography " }, command);
    expect(command.execute).toHaveBeenCalledWith({ ...input, referencePrice: 10, why: "Photography" });
  });
  it("rejects invalid service input without persistence", async () => {
    const command = { execute: vi.fn() };
    await expect(executeCreateWish({ ...input, target: 0 }, command)).rejects.toMatchObject({ code: "INVALID_WISH_REQUEST" });
    expect(command.execute).not.toHaveBeenCalled();
  });
  it("treats repeated/concurrent creates as independent operations, with no in-memory dedupe", async () => {
    const rpc = vi.fn(async () => ({ data: { wish: { ...wish, id: randomUUID() } }, error: null }));
    const command = adapter(rpc);
    const replies = await Promise.all([executeCreateWish(input, command), executeCreateWish(input, command)]);
    expect(rpc).toHaveBeenCalledTimes(2); expect(replies[0].data.wish.id).not.toBe(replies[1].data.wish.id);
  });
  it.each(["AUTHENTICATION_REQUIRED", "INVALID_WISH_REQUEST"])("preserves domain error %s", async (message) => {
    await expect(adapter(async () => ({ error: { message } })).execute(input)).rejects.toMatchObject({ code: message });
  });
  it.each(["PGRST202", "PGRST205", "42P01", "42883"])("fails closed when DB contract unavailable %s", async (code) => {
    const rpc = vi.fn(async () => ({ error: { code, message: "private database details" } }));
    await expect(adapter(rpc).execute(input)).rejects.toMatchObject({ code: "WISH_CREATION_UNAVAILABLE" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { wish: null }, { wish: { ...wish, status: "unlocking" } }, { wish: { ...wish, target: 60 } },
    { wish: { ...wish, referencePrice: 1 } }, { wish: { ...wish, why: "other" } }, { wish: { ...wish, startedAt: "now" } },
    { wish: { ...wish, coverPath: "forged" } }, { wish: { ...wish, id: "invalid" } }, { wish: { ...wish, createdAt: "bad" } },
  ])("rejects malformed/mismatched persistence response %#", async (data) => {
    await expect(adapter(async () => ({ data, error: null })).execute(input)).rejects.toThrow("invalid result");
  });
  it("propagates persistence failures without success effects/retry", async () => {
    const rpc = vi.fn(async () => ({ error: { code: "23503", message: "private detail" } }));
    await expect(executeCreateWish(input, adapter(rpc))).rejects.toThrow("Failed to execute Create Wish");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

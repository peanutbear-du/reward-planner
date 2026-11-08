import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedRequestContext } from "../../auth/authenticated-request";
import type { StartWishResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";
import { executeStartWish, StartWishCommandError } from "./start-wish";
import { createSupabaseStartWishCommand } from "./supabase-start-wish-command";
import { startWishPostHandler } from "./start-wish-http";

const id = "70000000-0000-4000-8000-000000000101", old = "70000000-0000-4000-8000-000000000102";
const wish = { id, title: "Camera", target: 60, progress: 1, status: "unlocking" as const, coverPath: null,
  startedAt: "2026-11-06T00:00:00Z", unlockedAt: null, redeemedAt: null, updatedAt: "2026-11-06T00:00:00Z" };
const result: StartWishResponse = { data: { changed: true, wish, previousWish: null, currentWishId: id, pendingApplied: 1, pendingRemaining: "0" },
  effects: ["wish_started", "pending_progress_applied", "wish_progress_changed"] };
const context = { supabase: {} } as AuthenticatedRequestContext;
const request = (value: unknown = { wishId: id }, authorization = "Bearer test-session") => new Request("http://localhost/api/commands/wish/start", { method: "POST", headers: { authorization }, body: JSON.stringify(value) });
const adapter = (rpc: unknown, mode: "start" | "switch" = "start") => createSupabaseStartWishCommand({ rpc } as SupabaseClient, mode);
describe("Wish lifecycle service / RPC / HTTP (mocks, not SQL locks)", () => {
  it("returns only transaction-confirmed effects through one user-scoped RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { ...result, private: "hidden", data: { ...result.data, private: "hidden", wish: { ...wish, userId: "hidden" } } }, error: null }));
    expect(await executeStartWish({ wishId: id.toUpperCase() }, adapter(rpc))).toEqual(result);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("start_wish", { p_wish_id: id });
  });
  it("switch uses its own RPC and preserves the old Wish and resume effect", async () => {
    const switched = { ...result, data: { ...result.data, previousWish: { ...wish, id: old, status: "wishlist" } },
      effects: ["wish_switched", "wish_resumed", "pending_progress_applied", "wish_progress_changed"] };
    const rpc = vi.fn(async () => ({ data: switched, error: null }));
    expect(await adapter(rpc, "switch").execute({ wishId: id })).toEqual(switched);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("switch_wish", { p_wish_id: id });
  });
  it("preserves no-op effects without fabricating a new start", async () => {
    const noop = { data: { ...result.data, changed: false, pendingApplied: 0 }, effects: [] };
    expect(await executeStartWish({ wishId: id }, adapter(async () => ({ data: noop })))).toEqual(noop);
  });
  it("invalid input never dispatches", async () => {
    const command = { execute: vi.fn() };
    await expect(executeStartWish({ wishId: "bad" }, command)).rejects.toMatchObject({ code: "INVALID_WISH_START_REQUEST" }); expect(command.execute).not.toHaveBeenCalled();
  });
  it.each(["AUTHENTICATION_REQUIRED", "INVALID_WISH_START_REQUEST", "WISH_NOT_FOUND", "WISH_ALREADY_UNLOCKING", "WISH_NOT_UNLOCKING", "WISH_START_NOT_ALLOWED", "REWARD_ALLOCATION_INCONSISTENT"])("preserves domain error %s", async message => {
    await expect(adapter(async () => ({ error: { message } })).execute({ wishId: id })).rejects.toMatchObject({ code: message });
  });
  it.each(["PGRST202", "PGRST205", "42P01", "42883", "55P03", "57014", "40P01", "40001"])("maps unavailable contract/transaction %s without retry", async code => {
    const rpc = vi.fn(async () => ({ error: { code, message: "private SQL" } }));
    await expect(adapter(rpc).execute({ wishId: id })).rejects.toMatchObject({ code: "WISH_START_UNAVAILABLE" }); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { ...result, effects: [] }, { ...result, data: { ...result.data, wish: { ...wish, id: old } } },
    { ...result, data: { ...result.data, wish: { ...wish, progress: 61 } } },
  ])("rejects malformed RPC result %#", async data => {
    await expect(adapter(async () => ({ data })).execute({ wishId: id })).rejects.toThrow("invalid result");
  });
  it("hides unknown SQL failures", async () => {
    await expect(adapter(async () => ({ error: { code: "XX000", message: "private SQL" } })).execute({ wishId: id })).rejects.toThrow("Failed to execute");
  });
  it.each(["start", "switch"] as const)("HTTP %s passes normalized identity and returns 200 no-store", async mode => {
    const command = vi.fn(async () => result), authenticate = vi.fn(async () => context);
    const r = await startWishPostHandler(mode, { authenticate, command })(request());
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store"); expect(await r.json()).toEqual(result);
    expect(authenticate).toHaveBeenCalledWith("test-session"); expect(command).toHaveBeenCalledExactlyOnceWith(context, { wishId: id });
  });
  it.each([{}, { wishId: "bad" }, ...["userId", "amount", "progress", "status", "startedAt"].map(k => ({ wishId: id, [k]: "forged" }))])("HTTP rejects forged fields %#", async body => {
    const command = vi.fn(), authenticate = vi.fn();
    expect((await startWishPostHandler("start", { authenticate, command })(request(body))).status).toBe(400); expect(command).not.toHaveBeenCalled();
  });
  it.each(["", "Basic x", "Bearer a b"])("rejects malformed auth %s", async auth => {
    const command = vi.fn(), authenticate = vi.fn();
    expect((await startWishPostHandler("start", { authenticate, command })(request(undefined, auth))).status).toBe(401); expect(authenticate).not.toHaveBeenCalled();
  });
  it("rejects expired identity and malformed JSON", async () => {
    const command = vi.fn();
    expect((await startWishPostHandler("start", { authenticate: async () => null, command })(request())).status).toBe(401); expect(command).not.toHaveBeenCalled();
    expect((await startWishPostHandler("start")(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
  });
  it.each([["AUTHENTICATION_REQUIRED", 401], ["INVALID_WISH_START_REQUEST", 400], ["WISH_NOT_FOUND", 404], ["WISH_ALREADY_UNLOCKING", 409],
    ["WISH_NOT_UNLOCKING", 409], ["WISH_START_NOT_ALLOWED", 409], ["REWARD_ALLOCATION_INCONSISTENT", 409], ["WISH_START_UNAVAILABLE", 503]] as const)("maps %s to %s", async (code, status) => {
    const r = await startWishPostHandler("start", { authenticate: async () => context, command: async () => { throw new StartWishCommandError(code); } })(request());
    expect(r.status).toBe(status); expect(await r.json()).toEqual({ error: code });
  });
  it("hides unexpected HTTP errors", async () => {
    const r = await startWishPostHandler("start", { authenticate: async () => { throw Error("private auth details"); }, command: vi.fn() })(request());
    expect(r.status).toBe(500); expect(await r.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

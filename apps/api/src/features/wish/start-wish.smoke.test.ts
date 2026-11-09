import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StartWishResponse, TodayResponse } from "@reward-planner/types";

// Opt-in ONLY after Migration Review/deployment. No fault hooks or old accounts.
describe.skipIf(!process.env.START_WISH_SMOKE_API_BASE_URL)("RP-M3-04 live lifecycle Smoke", () => {
  it("starts/switches/resumes, consumes Pending, reverses/reactivates and cleans fresh owners", async () => {
    const required = (name: string) => { const v = process.env[name]; if (!v) throw Error(`Missing ${name}`); return v; };
    const db = required("SUPABASE_URL"), key = required("SUPABASE_SERVICE_ROLE_KEY"), anon = required("SUPABASE_ANON_KEY"), api = required("START_WISH_SMOKE_API_BASE_URL");
    const linked = JSON.parse(readFileSync("supabase/.temp/linked-project.json", "utf8"));
    expect(linked).toMatchObject({ name: "reward-planner-dev", ref: "tvyvgcnllzhlowewajnp" });
    expect(db).toBe(`https://${linked.ref}.supabase.co`); expect(["127.0.0.1", "localhost"].includes(new URL(api).hostname)).toBe(true);
    const runId = randomUUID(), reportPath = `.env.m3-start-wish-${runId}-result.json`, deadline = Date.now() + 180000;
    const admin = { apikey: key, Authorization: `Bearer ${key}` };
    type Owner = { id: string; email: string; token: string };
    type Row = Record<string, unknown>;
    const owners: Owner[] = [], emails: string[] = [], passed: string[] = [], cleanup: { id: string; pass: boolean }[] = [];
    const tables = ["profiles", "user_settings", "tasks", "planning_items", "daily_plans", "daily_plan_items", "reward_events", "wishes", "reward_allocations", "wish_reward_state"];
    let uncertain = false, failed = false, stage = "initial", cleanupDeadline = 0;
    let firstStageDiagnostic: Record<string, string | number | null> | undefined;
    let localAuth: { status: number | null; ownerFixtureMatched: boolean; error?: string } | undefined;
    const report = (finished = false) => writeFileSync(reportPath, JSON.stringify({ runId, smokePid: process.pid, smokeFinished: finished,
      owners: owners.map(({ id, email }) => ({ id, email })), attemptedEmails: emails, passed, cleanup, failed, stage, uncertainRequests: uncertain,
      firstStageDiagnostic, localAuth,
      independentCleanup: "NOT TESTED" }, null, 2));
    report(); console.info(`M3-04 run report: ${reportPath}`);
    async function send(base: string, path: string, init: RequestInit = {}, clean = false) {
      const timeout = Math.min(clean ? 10000 : 12000, (clean ? cleanupDeadline : deadline) - Date.now());
      if (timeout <= 0) throw Error("Smoke deadline");
      try {
        const r = await fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(timeout), cache: "no-store" });
        if (init.method === "POST" && r.status >= 500) uncertain = true;
        return r;
      } catch { uncertain = true; throw Error("Request outcome unknown"); }
    }
    async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
      const r = await send(db, path, { ...init, headers: { ...admin, "Content-Type": "application/json", ...init.headers } });
      if (!r.ok) throw Error(`HTTP ${r.status} at ${stage}`);
      try { const text = await r.text(); return (text ? JSON.parse(text) : null) as T; } catch { uncertain = true; throw Error("Response not confirmed"); }
    }
    const auth = (o: Owner) => ({ apikey: anon, Authorization: `Bearer ${o.token}` });
    async function createOwner(label: string) {
      const email = `rp-m3-04-${runId}-${label}@example.test`, password = randomBytes(24).toString("base64url") + "aA1!";
      emails.push(email); report();
      const user = await json<{ id: string }>("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true,
        user_metadata: { purpose: "RP-M3-04 Smoke", run_id: runId } }) });
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      const o = { id: user.id, email, token: "" }; owners.push(o); report();
      o.token = (await json<{ access_token: string }>("/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${anon}` }, body: JSON.stringify({ email, password }) })).access_token;
      return o;
    }
    const rows = (o: Owner, table: string) => json<Row[]>(`/rest/v1/${table}?select=*&${table === "profiles" ? "id" : "user_id"}=eq.${o.id}&order=${table === "wish_reward_state" ? "reward_event_id" : "id"}`);
    const rpc = <T>(o: Owner, name: string, body: unknown) => json<T>(`/rest/v1/rpc/${name}`, { method: "POST", headers: auth(o), body: JSON.stringify(body) });
    const wish = async (o: Owner, title: string, target: number) => (await rpc<{ wish: { id: string } }>(o, "create_wish", { p_title: title, p_target: target })).wish.id;
    const act = (o: Owner | null, id: string, mode = "start", extra = {}) => send(api, `/api/commands/wish/${mode}`, { method: "POST", headers: {
      "Content-Type": "application/json", ...(o ? { Authorization: `Bearer ${o.token}` } : {}) }, body: JSON.stringify({ wishId: id, ...extra }) });
    async function command(o: Owner, id: string, mode = "start") {
      const r = await act(o, id, mode); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
      return await r.json() as StartWishResponse;
    }
    async function daily(o: Owner, date: string, complete = false) {
      // Only fresh-owner fixture rows. Real triggers generate genuine Daily +1s.
      const task = randomUUID(), plan = randomUUID();
      await json("/rest/v1/tasks", { method: "POST", body: JSON.stringify({ id: task, user_id: o.id, title: "Smoke daily" }) });
      await json("/rest/v1/daily_plans", { method: "POST", body: JSON.stringify({ id: plan, user_id: o.id, plan_date: date, status: "committed", snapshot_created_at: new Date().toISOString() }) });
      await json("/rest/v1/daily_plan_items", { method: "POST", body: JSON.stringify({ user_id: o.id, daily_plan_id: plan, task_id: task,
        title_snapshot: "Frozen smoke", result_status: complete ? "completed" : "pending", completed_at_on_day: complete ? new Date().toISOString() : null }) });
      return task;
    }
    async function check(name: string, fn: () => Promise<void>) { stage = name; await fn(); passed.push(name); }
    async function discoverOwners() {
      for (let page = 1; page <= 100; page++) {
        const r = await send(db, `/auth/v1/admin/users?page=${page}&per_page=100`, { headers: admin }, true);
        if (!r.ok) throw Error("Discovery unavailable");
        const body = await r.json(); if (!Array.isArray(body.users)) throw Error("Malformed discovery");
        for (const u of body.users) if (emails.includes(u.email)) {
          if (u.user_metadata?.run_id !== runId || u.user_metadata?.purpose !== "RP-M3-04 Smoke" || !/^[0-9a-f-]{36}$/.test(u.id)) throw Error("Identity mismatch");
          if (!owners.some(o => o.id === u.id)) owners.push({ id: u.id, email: u.email, token: "" });
        }
        if (body.users.length === 0) return;
      }
      throw Error("Discovery incomplete");
    }
    try {
      const a = await createOwner("a"), b = await createOwner("b");
      await json("/rest/v1/user_settings", { method: "POST", body: JSON.stringify({ user_id: a.id, timezone: "UTC" }) });
      const wa = await wish(a, "A", 3), wb = await wish(a, "B", 3), exact = await wish(a, "Protected", 1);
      const overflow = await wish(b, "Overflow", 1), bnext = await wish(b, "Remaining", 1);
      const date = new Date().toISOString().slice(0, 10), task = await daily(a, date);
      const complete = (done: boolean) => rpc(a, "set_task_completion", { p_date: date, p_task_id: task, p_completed: done });
      await check("local API authenticates the Start owner's token and reads their fixture", async () => {
        localAuth = { status: null, ownerFixtureMatched: false, error: "no response" };
        const response = await send(api, `/api/today?date=${date}`, {
          headers: { Authorization: `Bearer ${a.token}` },
        });
        localAuth = { status: response.status, ownerFixtureMatched: false };
        if (!response.ok) {
          const body: { error?: unknown } | null = await response.json().catch(() => null);
          if (body?.error === "UNAUTHORIZED" || body?.error === "INTERNAL_SERVER_ERROR" || body?.error === "INVALID_DATE") {
            localAuth.error = body.error;
          }
        }
        expect(response.status).toBe(200);
        const { items } = await response.json() as TodayResponse;
        localAuth.ownerFixtureMatched = Object.values(items).some(group => group.some(item => item.taskId === task));
        expect(localAuth.ownerFixtureMatched).toBe(true);
      });
      let startedAt: string | null = null;
      await check("zero Pending, ownership, strict fields and Start conflict", async () => {
        const publicErrors = new Set(["UNAUTHORIZED", "INVALID_REQUEST", "INTERNAL_SERVER_ERROR",
          "AUTHENTICATION_REQUIRED", "INVALID_WISH_START_REQUEST", "WISH_NOT_FOUND",
          "WISH_ALREADY_UNLOCKING", "WISH_NOT_UNLOCKING", "WISH_START_NOT_ALLOWED",
          "REWARD_ALLOCATION_INCONSISTENT", "WISH_START_UNAVAILABLE"]);
        async function assertStatus(name: string, wishId: string, expected: number, request: () => Promise<Response>) {
          firstStageDiagnostic = { assertion: name, wishId, expected, actual: "no response" };
          const response = await request();
          const body: { error?: unknown } | null = response.ok ? null : await response.json().catch(() => null);
          const error = body?.error;
          firstStageDiagnostic = {
            assertion: name, wishId, expected, actual: response.status, httpStatus: response.status,
            publicError: typeof error === "string" && publicErrors.has(error) ? error : null,
          };
          expect(response.status, name).toBe(expected);
          return response;
        }

        const response = await assertStatus("authenticated Start status", wa, 200, () => act(a, wa));
        const cacheControl = response.headers.get("cache-control");
        const cacheName = "authenticated Start cache-control";
        firstStageDiagnostic = { assertion: cacheName, wishId: wa, httpStatus: response.status, expected: "private, no-store",
          actual: cacheControl === null || cacheControl === "private, no-store" ? cacheControl : "unexpected cache directive" };
        expect(cacheControl, cacheName).toBe("private, no-store");
        firstStageDiagnostic = { assertion: "authenticated Start response JSON", wishId: wa, httpStatus: response.status };
        const r = await response.json() as StartWishResponse;
        const pendingName = "authenticated Start applies zero Pending";
        const pending = r.data?.pendingApplied;
        firstStageDiagnostic = { assertion: pendingName, wishId: wa, httpStatus: response.status, expected: 0,
          actual: typeof pending === "number" ? pending : "missing or nonnumeric" };
        expect(pending, pendingName).toBe(0);
        const wishStatusName = "authenticated Start sets Wish to unlocking";
        const wishStatus = r.data.wish?.status;
        firstStageDiagnostic = { assertion: wishStatusName, wishId: wa, httpStatus: response.status, expected: "unlocking",
          actual: ["wishlist", "unlocking", "unlocked", "redeemed"].includes(wishStatus) ? wishStatus : "missing or unknown" };
        expect(wishStatus, wishStatusName).toBe("unlocking");
        startedAt = r.data.wish.startedAt;
        await assertStatus("unauthenticated Start status", wa, 401, () => act(null, wa));
        await assertStatus("Start for another owner's Wish status", wa, 404, () => act(b, wa));
        await assertStatus("Start with extra amount field status", wa, 400, () => act(a, wa, "start", { amount: 999 }));
        await assertStatus("Start with a different current Wish status", wb, 409, () => act(a, wb));
        firstStageDiagnostic = undefined;
      });
      await check("same target no-op leaves complete ledger and Wish snapshots unchanged", async () => {
        const before = await Promise.all([rows(a, "wishes"), rows(a, "reward_allocations"), rows(a, "wish_reward_state")]);
        const r = await command(a, wa); expect(r.data.changed).toBe(false); expect(r.effects).toEqual([]);
        expect(await Promise.all([rows(a, "wishes"), rows(a, "reward_allocations"), rows(a, "wish_reward_state")])).toEqual(before);
      });
      await check("Daily allocation, switch, paused reversal and reactivation to current", async () => {
        await complete(true); const source = (await rows(a, "reward_events"))[0];
        const switched = await command(a, wb, "switch"); expect(switched.data.previousWish?.progress).toBe(1);
        await complete(false); expect((await rows(a, "reward_allocations")).filter(r => r.wish_id === wa).reduce((n, r) => n + Number(r.amount), 0)).toBe(0);
        await complete(true); const after = (await rows(a, "reward_events"))[0];
        expect([after.id, after.amount, after.created_at]).toEqual([source.id, source.amount, source.created_at]);
        const resumed = await command(a, wa, "switch"); expect(resumed.data.wish.startedAt).toBe(startedAt); expect(resumed.data.previousWish?.progress).toBe(1);
      });
      await check("terminal protection and immediate-unlock retry cannot duplicate source", async () => {
        await command(a, exact, "switch"); await complete(false); await complete(true);
        const target = (await rows(a, "wishes")).find(w => w.id === exact)!; expect(target.status).toBe("unlocked");
        await complete(false); await complete(true);
        expect((await rows(a, "wishes")).find(w => w.id === exact)?.status).toBe("unlocked");
        expect((await rows(a, "reward_allocations")).filter(r => r.allocation_type === "pending").reduce((n, r) => n + Number(r.amount), 0)).toBe(0);
        const ledger = await rows(a, "reward_allocations"); expect((await act(a, exact)).status).toBe(409); expect(await rows(a, "reward_allocations")).toEqual(ledger);
        expect((await act(a, wa, "switch")).status).toBe(409);
      });
      await check("multiple genuine +1 sources: Pending overflow and exact Start", async () => {
        await daily(b, "2026-01-01", true); await daily(b, "2026-01-02", true);
        const r = await command(b, overflow); expect(r.data.wish.status).toBe("unlocked"); expect(r.data.pendingApplied).toBe(1); expect(r.data.pendingRemaining).toBe("1"); expect(r.data.currentWishId).toBeNull();
        const next = await command(b, bnext); expect(next.data.wish.status).toBe("unlocked"); expect(next.data.pendingRemaining).toBe("0");
      });
      await check("client write and internal RPC bypass denied", async () => {
        const r = await send(db, "/rest/v1/rpc/prepare_wish_rewards", { method: "POST", headers: { ...auth(a), "Content-Type": "application/json" }, body: JSON.stringify({ p_user_id: a.id }) }); expect(r.ok).toBe(false);
        const write = await send(db, `/rest/v1/wishes?id=eq.${wa}`, { method: "PATCH", headers: { ...auth(a), "Content-Type": "application/json" }, body: JSON.stringify({ status: "unlocked" }) }); expect(write.ok).toBe(false);
      });
    } catch {
      failed = true;
      if (localAuth && !localAuth.ownerFixtureMatched) console.error("M3-04 local Auth:", JSON.stringify(localAuth));
      if (firstStageDiagnostic) console.error("M3-04 first stage assertion:", JSON.stringify(firstStageDiagnostic));
    }
    finally {
      cleanupDeadline = Date.now() + 90000;
      // Recover unknown account creation by exact run-tag/email/purpose only.
      try { await discoverOwners(); } catch { failed = true; }
      for (const o of owners) {
        try {
          const user = await send(db, `/auth/v1/admin/users/${o.id}`, { headers: admin }, true);
          if (user.status !== 404) {
            expect(user.ok).toBe(true); const body = await user.json(); expect(body.email).toBe(o.email); expect(body.user_metadata).toMatchObject({ run_id: runId, purpose: "RP-M3-04 Smoke" });
            const list = await send(db, "/storage/v1/object/list/wish-covers", { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: `${o.id}/`, limit: 1 }) }, true);
            expect(list.ok).toBe(true); expect(await list.json()).toEqual([]);
            expect((await send(db, `/auth/v1/admin/users/${o.id}`, { method: "DELETE", headers: admin }, true)).ok).toBe(true);
          }
          expect((await send(db, `/auth/v1/admin/users/${o.id}`, { headers: admin }, true)).status).toBe(404);
          for (const table of tables) {
            const r = await send(db, `/rest/v1/${table}?select=${table === "profiles" ? "id" : "user_id"}&${table === "profiles" ? "id" : "user_id"}=eq.${o.id}&limit=1`, { headers: admin }, true);
            expect(r.ok).toBe(true); expect(await r.json()).toEqual([]);
          }
          cleanup.push({ id: o.id, pass: true });
        } catch { cleanup.push({ id: o.id, pass: false }); failed = true; }
      }
      if (uncertain) failed = true;
      report(true); expect(failed, `Lifecycle Smoke failed at ${stage}; inspect scoped report`).toBe(false);
    }
  }, 300000);
});

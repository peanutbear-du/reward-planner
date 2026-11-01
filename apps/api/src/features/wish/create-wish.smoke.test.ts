import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Existing opt-in Vitest/HTTP pattern. Never installs SQL or uses a real account.
describe.skipIf(!process.env.CREATE_WISH_SMOKE_API_BASE_URL)("RP-M3-02 real API Smoke", () => {
  it("creates isolated Wishlist records without changing reward/execution truth", async () => {
    const required = (key: string) => { const value = process.env[key]; if (!value) throw Error(`Missing ${key}`); return value; };
    const api = required("CREATE_WISH_SMOKE_API_BASE_URL"), db = required("SUPABASE_URL");
    const anon = required("SUPABASE_ANON_KEY"), secret = required("SUPABASE_SECRET_KEY");
    const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
    expect(JSON.parse(readFileSync("supabase/.temp/linked-project.json", "utf8"))).toMatchObject({ name: "reward-planner-dev", ref });
    expect(new URL(db).hostname).toBe(`${ref}.supabase.co`);
    const configured = /^SUPABASE_URL\s*=\s*["']?([^\s"']+)/m.exec(readFileSync("apps/api/.env.local", "utf8"))?.[1];
    expect(configured && new URL(configured).hostname).toBe(`${ref}.supabase.co`);
    expect(["127.0.0.1", "localhost"].includes(new URL(api).hostname)).toBe(true);
    const runId = randomUUID(), start = Date.now(), deadline = start + 240_000;
    const owners: { id: string; email: string; token: string }[] = [], attemptedEmails: string[] = [], passed: string[] = [];
    const evidence: Record<string, unknown> = {}, cleanup: Record<string, unknown>[] = [];
    const admin = { apikey: secret, Authorization: `Bearer ${secret}` };
    type Owner = typeof owners[number];
    type Row = Record<string, unknown>;
    const auth = (o: Owner) => ({ apikey: anon, Authorization: `Bearer ${o.token}` });
    let stage = "read-only preflight", failed = false;
    async function send(base: string, path: string, init: RequestInit = {}, cleaning = false) {
      const ms = cleaning ? 10_000 : Math.min(12_000, deadline - Date.now());
      if (ms <= 0) throw Error("Work deadline reached");
      return fetch(new URL(path, base), { ...init, headers: { "Content-Type": "application/json", ...init.headers }, cache: "no-store", signal: AbortSignal.timeout(ms) });
    }
    async function json<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
      const r = await send(base, path, init); if (!r.ok) throw Error(`HTTP ${r.status} during ${stage}`);
      const body = await r.text(); return (body ? JSON.parse(body) : null) as T;
    }
    const rows = (o: Owner, table: string) => json<Row[]>(db, `/rest/v1/${table}?select=*&user_id=eq.${o.id}&order=id`, { headers: admin });
    const post = (token: string | null, input: unknown, raw = false) => send(api, "/api/commands/wish/create", {
      method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: raw ? input as string : JSON.stringify(input),
    });
    const rpc = (o: Owner, input: unknown) => send(db, "/rest/v1/rpc/create_wish", { method: "POST", headers: auth(o), body: JSON.stringify(input) });
    async function owner(label: string) {
      const email = `rp-m3-02-${runId}-${label}@example.test`, password = `${randomBytes(24).toString("base64url")}aA1!`;
      attemptedEmails.push(email);
      const user = await json<{ id: string }>(db, "/auth/v1/admin/users", { method: "POST", headers: admin,
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { purpose: "RP-M3-02 Smoke", run_id: runId } }) });
      const o = { id: user.id, email, token: "" }; owners.push(o);
      o.token = (await json<{ access_token: string }>(db, "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: anon }, body: JSON.stringify({ email, password }) })).access_token;
      return o;
    }
    async function seed(o: Owner, table: string, values: Row[]) {
      expect(owners.some((u) => u.id === o.id)).toBe(true); expect(values.every((r) => r.user_id === o.id)).toBe(true);
      expect(values.every((r) => !["amount", "is_qualified", "completion_rate"].some((k) => k in r) || table === "reward_allocations")).toBe(true);
      await json(db, `/rest/v1/${table}`, { method: "POST", headers: admin, body: JSON.stringify(values) });
    }
    async function created(o: Owner, input: Row) {
      const response = await post(o.token, input); expect(response.status, stage).toBe(201);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json() as { data: { wish: Row }; effects: string[] }, w = body.data.wish;
      expect(body.effects).toEqual(["wish_created"]);
      expect(Object.keys(w).sort()).toEqual(["id", "title", "target", "status", "coverPath", "startedAt", "unlockedAt", "redeemedAt", "referencePrice", "why", "createdAt", "updatedAt"].sort());
      expect(w).toMatchObject({ status: "wishlist", coverPath: null, startedAt: null, unlockedAt: null, redeemedAt: null });
      expect(w.id).toMatch(/^[0-9a-f-]{36}$/); expect(Number.isFinite(Date.parse(w.createdAt as string))).toBe(true); expect(Number.isFinite(Date.parse(w.updatedAt as string))).toBe(true);
      const persisted = (await rows(o, "wishes")).find((r) => r.id === w.id)!;
      expect(persisted).toMatchObject({ user_id: o.id, title: w.title, target: w.target, status: "wishlist", cover_path: null,
        started_at: null, unlocked_at: null, redeemed_at: null, reference_price: w.referencePrice, why: w.why });
      expect(Date.parse(persisted.created_at as string)).toBe(Date.parse(w.createdAt as string));
      return w;
    }
    async function check(name: string, action: () => Promise<void>) { stage = name; await action(); passed.push(name); }
    try {
      stage = "local unauthenticated route preflight";
      expect((await post(null, { title: "Probe", target: 1 })).status).toBe(401);
      stage = "Dev table preflight";
      await json(db, "/rest/v1/wishes?select=id&limit=0", { headers: admin });
      stage = "independent accounts and RPC preflight";
      const a = await owner("a"), b = await owner("b");
      const probe = await rpc(a, { p_title: null, p_target: null });
      expect(probe.status).toBe(400); expect(await probe.json()).toMatchObject({ code: "22023", message: "INVALID_WISH_REQUEST" });
      const task = randomUUID(), plan = randomUUID(), current = randomUUID(), today = new Date().toISOString().slice(0, 10);
      await seed(a, "user_settings", [{ user_id: a.id, timezone: "UTC" }]);
      await seed(a, "tasks", [{ id: task, user_id: a.id, title: `Existing ${runId}` }]);
      await seed(a, "daily_plans", [{ id: plan, user_id: a.id, plan_date: today, status: "committed", snapshot_created_at: new Date().toISOString() }]);
      await seed(a, "daily_plan_items", [{ user_id: a.id, daily_plan_id: plan, task_id: task, title_snapshot: "Frozen existing" }]);
      await json(db, "/rest/v1/rpc/set_task_completion", { method: "POST", headers: auth(a), body: JSON.stringify({ p_date: today, p_task_id: task, p_completed: true }) });
      const event = (await rows(a, "reward_events"))[0]; expect(event).toMatchObject({ amount: 1, status: "active" });
      await seed(a, "reward_allocations", [{ user_id: a.id, reward_event_id: event.id, allocation_type: "pending", wish_id: null, amount: 1 }]);
      await seed(a, "wishes", [{ id: current, user_id: a.id, title: "Existing current", target: 60, status: "unlocking", started_at: new Date().toISOString() }]);
      const before: Record<string, Row[]> = {};
      for (const table of ["tasks", "daily_plans", "daily_plan_items", "reward_events", "reward_allocations"]) before[table] = await rows(a, table);
      const currentBefore = (await rows(a, "wishes")).find((r) => r.id === current);
      const chars = String.fromCharCode(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279);
      let main: Row;
      await check("Authenticated HTTP 201, complete DTO, Wishlist persistence and normalization", async () => {
        main = await created(a, { title: `${chars}Camera${chars}`, target: 137, referencePrice: 123.45, why: `${chars}Learn\nphotography${chars}` });
        expect(main).toMatchObject({ title: "Camera", target: 137, referencePrice: 123.45, why: "Learn\nphotography" }); evidence.created = main;
      });
      await check("Defaults, blank Why, zero price and integer maximum", async () => {
        expect(await created(a, { title: "Defaults", target: 20 })).toMatchObject({ referencePrice: null, why: null });
        expect(await created(a, { title: "Zero metadata", target: 2147483647, referencePrice: 0, why: chars })).toMatchObject({ referencePrice: 0, why: null });
      });
      await check("Direct authenticated RPC trims all 25 characters without relying on API", async () => {
        const reply = await rpc(a, { p_title: `${chars}Direct RPC${chars}`, p_target: 40, p_reference_price: null, p_why: chars });
        expect(reply.status).toBe(200); const body = await reply.json(); expect(body.wish).toMatchObject({ title: "Direct RPC", why: null, status: "wishlist" }); evidence.directRpc = body.wish;
      });
      await check("Invalid target/price/title and forged consequences refused without insertion", async () => {
        const old = await rows(a, "wishes");
        for (const input of [{ title: " ", target: 1 }, ...[0,-1,1.5,2147483648,"60"].map((target) => ({ title: "Bad", target })),
          ...[-1,"NaN","Infinity"].map((referencePrice) => ({ title: "Bad", target: 1, referencePrice })),
          { title: "Bad", target: 1, userId: b.id }, { title: "Bad", target: 1, status: "unlocking" }, { title: "Bad", target: 1, coverPath: "forged" }]) {
          const r = await post(a.token, input); expect(r.status).toBe(400); expect(await r.json()).toEqual({ error: "INVALID_REQUEST" });
        }
        expect((await post(a.token, '{"title":"Bad","target":1,"referencePrice":1e309}', true)).status).toBe(400);
        expect((await post(a.token, '{"title":"Bad","target":1,"referencePrice":NaN}', true)).status).toBe(400);
        for (const price of ["-1", "NaN", "Infinity", "-Infinity", "2e308"]) {
          const r = await rpc(a, { p_title: "Bad direct", p_target: 1, p_reference_price: price });
          expect(r.status).toBe(400); expect(await r.json()).toMatchObject({ message: "INVALID_WISH_REQUEST", code: "22023" });
        }
        expect(await rows(a, "wishes")).toEqual(old);
      });
      await check("Unauthenticated/invalid token rejected and two-owner SELECT isolation", async () => {
        expect((await post(null, { title: "No auth", target: 1 })).status).toBe(401);
        expect((await post("invalid-session", { title: "No auth", target: 1 })).status).toBe(401);
        const ownB = await created(b, { title: "B Wishlist", target: 100 });
        for (const [o, foreign] of [[a,b],[b,a]]) {
          expect(await json(db, `/rest/v1/wishes?select=id&user_id=eq.${foreign.id}`, { headers: auth(o) })).toEqual([]);
          const own = await json<Row[]>(db, `/rest/v1/wishes?select=*&user_id=eq.${o.id}`, { headers: auth(o) }); expect(own.length).toBeGreaterThan(0); expect(own.every((r) => r.user_id === o.id)).toBe(true);
        }
        evidence.bWish = ownB;
      });
      await check("Client direct INSERT/UPDATE and anonymous read/RPC remain denied", async () => {
        for (const method of ["POST", "PATCH"]) {
          const r = await send(db, `/rest/v1/wishes?user_id=eq.${a.id}`, { method, headers: auth(a), body: JSON.stringify({ user_id: a.id, title: "Forged", target: 1 }) });
          expect(r.status).toBe(403); expect(await r.json()).toMatchObject({ code: "42501" });
        }
        const r = await send(db, "/rest/v1/wishes?select=id&limit=1", { headers: { apikey: anon, Authorization: `Bearer ${anon}` } }); expect(r.status).toBe(401); expect(await r.json()).toMatchObject({ code: "42501" });
        const q = await send(db, "/rest/v1/rpc/create_wish", { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${anon}` }, body: JSON.stringify({ p_title: "Anon", p_target: 1 }) }); expect(q.status).toBe(401); expect(await q.json()).toMatchObject({ code: "42501" });
      });
      await check("Repeated POSTs persist two separate Wishlist identities", async () => {
        const title = `Repeat ${runId}`, replies = await Promise.allSettled([created(a, { title, target: 60 }), created(a, { title, target: 60 })]);
        expect(replies.every((r) => r.status === "fulfilled")).toBe(true);
        const ids = replies.map((r) => (r as PromiseFulfilledResult<Row>).value.id); expect(new Set(ids).size).toBe(2);
        expect((await rows(a, "wishes")).filter((r) => r.title === title)).toHaveLength(2); evidence.repeatedIds = ids;
      });
      await check("No allocation/start/unlock or Daily Reward/execution side effects", async () => {
        for (const table of Object.keys(before)) expect(await rows(a, table), table).toEqual(before[table]);
        const wishes = await rows(a, "wishes"); expect(wishes.find((r) => r.id === current)).toEqual(currentBefore);
        expect(wishes.filter((r) => r.status === "unlocking")).toHaveLength(1);
        expect(wishes.filter((r) => r.id !== current).every((w) => w.status === "wishlist" && [w.started_at,w.unlocked_at,w.redeemed_at,w.cover_path].every((v) => v === null))).toBe(true);
        expect(await rows(b, "reward_events")).toEqual([]); expect(await rows(b, "reward_allocations")).toEqual([]);
        evidence.sideEffects = { unchangedTables: Object.keys(before), dailyEvent: event, preservedCurrentWish: currentBefore, wishCountA: wishes.length };
      });
    } catch (error) {
      failed = true; evidence.failure = { stage, reason: error instanceof Error ? error.message.slice(0, 500) : "Unknown failure",
        causeCode: error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? error.cause.code : null,
        proxyConfigured: !!process.env.HTTPS_PROXY, workerEnvProxyEnabled: process.env.NODE_USE_ENV_PROXY === "1" };
    } finally {
      for (const o of owners) {
        const entry: Record<string, unknown> = { userId: o.id }, counts: Record<string, number> = {};
        try {
          expect((await send(db, `/auth/v1/admin/users/${o.id}`, { method: "DELETE", headers: admin }, true)).ok).toBe(true);
          const checks = await Promise.allSettled(["profiles", "user_settings", "tasks", "planning_items", "daily_plans", "daily_plan_items", "reward_events", "wishes", "reward_allocations"].map(async (table) => {
            const key = table === "profiles" ? "id" : "user_id", r = await send(db, `/rest/v1/${table}?select=${key}&${key}=eq.${o.id}`, { headers: admin }, true);
            expect(r.ok).toBe(true); counts[table] = (await r.json()).length; expect(counts[table], table).toBe(0);
          })); expect(checks.every((r) => r.status === "fulfilled")).toBe(true);
          const r = await send(db, `/auth/v1/admin/users/${o.id}`, { headers: admin }, true); expect(r.status).toBe(404);
          entry.authStatus = r.status; entry.pass = true;
        } catch { entry.pass = false; failed = true; }
        entry.counts = counts; cleanup.push(entry);
      }
      const unresolvedEmails = attemptedEmails.filter((email) => !owners.some((o) => o.email === email)); if (unresolvedEmails.length) failed = true;
      writeFileSync(".env.m3-create-wish-smoke-result.json", JSON.stringify({ runId, failed, stage, passed, evidence, elapsedSeconds: (Date.now()-start)/1000,
        owners: owners.map(({ id,email }) => ({ id,email })), cleanup, unresolvedEmails }, null, 2));
      expect(failed, `Smoke failed during ${stage}; see non-secret ignored report`).toBe(false);
    }
  }, 360_000);
});

import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { CreateTaskResponse, TaskExecutionResponse, UpsertDraftTodayItemResponse } from "@reward-planner/types";
import { describe, expect, it } from "vitest";

// Separate opt-in run AFTER migration approval/application. Never pushes SQL.
// Only fresh, recorded test owners are provisioned and removed in finally.
describe.skipIf(!process.env.DAILY_REWARD_SMOKE_API_BASE_URL)("RP-M2-03 real Daily Reward smoke", () => {
  it("serializes reward transitions, retries and ownership through existing Business API commands", async () => {
    const required = (name: string) => {
      const value = process.env[name];
      if (!value) throw new Error(`Missing ${name}.`);
      return value;
    };
    const apiBase = required("DAILY_REWARD_SMOKE_API_BASE_URL");
    const dbBase = required("SUPABASE_URL");
    const anonKey = required("SUPABASE_ANON_KEY");
    const secretKey = required("SUPABASE_SECRET_KEY");
    expect(["127.0.0.1", "localhost"].includes(new URL(apiBase).hostname)).toBe(true);
    const runId = randomUUID();
    const deadline = Date.now() + 180_000;
    const users: { id: string; email: string; token: string }[] = [];
    const attemptedEmails: string[] = [];
    const passed: string[] = [];
    const cleanup: { userId: string; removed: boolean }[] = [];
    const adminHeaders = { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
    const userHeaders = (user: User) => ({ apikey: anonKey, Authorization: `Bearer ${user.token}` });
    let step = "preflight";
    let failed = false;
    type User = typeof users[number];
    type Row = Record<string, unknown>;

    async function send(base: string, path: string, init: RequestInit = {}, cleaning = false) {
      const remaining = cleaning ? 10_000 : Math.min(15_000, deadline - Date.now());
      if (remaining <= 0) throw new Error("Daily Reward smoke deadline reached.");
      try {
        return await fetch(new URL(path, base), { ...init,
          headers: { "Content-Type": "application/json", ...init.headers },
          signal: AbortSignal.timeout(remaining), cache: "no-store" });
      } catch { throw new Error(`Daily Reward smoke network failure: ${step}.`); }
    }
    async function json<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
      const response = await send(base, path, init);
      if (!response.ok) throw new Error(`Daily Reward smoke HTTP ${response.status}: ${step}.`);
      const body = await response.text();
      return (body ? JSON.parse(body) : undefined) as T;
    }
    const post = <T>(user: User, path: string, input: unknown) => json<T>(apiBase, `/api/commands/${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${user.token}` }, body: JSON.stringify(input),
    });
    const rows = (user: User, table: string, filter = "") => json<Row[]>(dbBase,
      `/rest/v1/${table}?select=*&${filter}`, { headers: userHeaders(user) });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const execute = (user: User, taskId: string, completed: boolean) => post<TaskExecutionResponse>(user,
      completed ? "task/complete" : "task/uncomplete", { taskId, date: today });
    async function concurrent(actions: Promise<unknown>[]) {
      // Drain every request before assertions/cleanup, including failure cases.
      const results = await Promise.allSettled(actions);
      expect(results.every((result) => result.status === "fulfilled"), "all concurrent commands succeeded").toBe(true);
    }
    async function owner(label: string) {
      const email = `rp-m2-03-${runId}-${label}@example.test`;
      attemptedEmails.push(email);
      const password = `${randomBytes(24).toString("base64url")}aA1!`;
      const created = await json<{ id: string }>(dbBase, "/auth/v1/admin/users", {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { purpose: "RP-M2-03 smoke", run_id: runId } }),
      });
      const user = { id: created.id, email, token: "" };
      users.push(user);
      const auth = await json<{ access_token: string }>(dbBase, "/auth/v1/token?grant_type=password", {
        method: "POST", headers: { apikey: anonKey }, body: JSON.stringify({ email, password }),
      });
      user.token = auth.access_token;
      await json(dbBase, "/rest/v1/user_settings", { method: "POST", headers: userHeaders(user),
        body: JSON.stringify({ user_id: user.id, timezone: "UTC" }) });
      return user;
    }
    async function task(user: User, label: string) {
      const response = await post<CreateTaskResponse>(user, "task/create", { title: `RP-M2-03 ${runId} ${label}`, schedule: null });
      return response.data.task.id;
    }
    async function fixture(user: User) {
      const tasks: string[] = [];
      let planId = "";
      for (let i = 0; i < 5; i++) {
        const id = await task(user, `Task ${i}`);
        tasks.push(id);
        const draft = await post<UpsertDraftTodayItemResponse>(user, "today/draft/upsert-item", { date: today, taskId: id, priority: "plan" });
        planId = draft.data.dailyPlanId;
      }
      await post(user, "today/commit", { date: today });
      return { tasks, planId };
    }
    async function verify(user: User, planId: string, expectedQualified: boolean, original?: Row) {
      const plans = await rows(user, "daily_plans", `id=eq.${planId}`);
      const events = await rows(user, "reward_events", `source_id=eq.${planId}`);
      expect(plans).toHaveLength(1);
      expect(plans[0].is_qualified).toBe(expectedQualified);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ user_id: user.id, source_type: "DAILY_QUALIFIED", source_id: planId,
        amount: 1, status: expectedQualified ? "active" : "reversed" });
      expect(expectedQualified ? events[0].reversed_at === null : typeof events[0].reversed_at === "string").toBe(true);
      if (original) expect(events[0]).toMatchObject({ id: original.id, created_at: original.created_at });
      return events[0];
    }

    try {
      // Fail before provisioning anything if this database lacks the new schema.
      await json(dbBase, "/rest/v1/reward_events?select=id&limit=0", { headers: adminHeaders });
      step = "fresh users and committed fixtures";
      const a = await owner("a");
      const b = await owner("b");
      const fa = await fixture(a);
      const fb = await fixture(b);
      const snapshots = await rows(a, "daily_plan_items", `daily_plan_id=eq.${fa.planId}`);
      expect(await rows(a, "reward_events")).toEqual([]);
      for (const id of fa.tasks.slice(0, 3)) await execute(a, id, true);
      expect(await rows(a, "reward_events")).toEqual([]);

      step = "concurrent first grant and active retries";
      await concurrent(Array.from({ length: 4 }, () => execute(a, fa.tasks[3], true)));
      const first = await verify(a, fa.planId, true);
      await execute(a, fa.tasks[4], true); // 100% does not grant extra.
      await execute(a, fa.tasks[4], false);
      expect(await verify(a, fa.planId, true)).toEqual(first);
      passed.push(step);

      step = "concurrent reversal, false retry and reactivation";
      await concurrent(Array.from({ length: 4 }, () => execute(a, fa.tasks[3], false)));
      const reversed = await verify(a, fa.planId, false, first);
      await execute(a, fa.tasks[3], false);
      expect(await verify(a, fa.planId, false, first)).toEqual(reversed);
      await concurrent([execute(a, fa.tasks[3], true), execute(a, fa.tasks[4], true)]);
      expect(await verify(a, fa.planId, true, first)).toEqual(first);
      await concurrent([execute(a, fa.tasks[3], false), execute(a, fa.tasks[4], false)]);
      await verify(a, fa.planId, false, first);
      await execute(a, fa.tasks[3], true);
      passed.push(step);

      step = "opposing concurrent actions";
      await concurrent([execute(a, fa.tasks[3], false), execute(a, fa.tasks[3], true)]);
      const current = (await rows(a, "daily_plans", `id=eq.${fa.planId}`))[0];
      await verify(a, fa.planId, current.is_qualified === true, first);
      await execute(a, fa.tasks[3], true);
      passed.push(step);

      step = "Added Later qualification reversal and reactivation";
      const added = await task(a, "Added Later");
      await post(a, "today/add-later", { date: today, taskId: added, priority: "plan" });
      await verify(a, fa.planId, false, first);
      await execute(a, added, true);
      expect(await verify(a, fa.planId, true, first)).toEqual(first);
      const after = await rows(a, "daily_plan_items", `daily_plan_id=eq.${fa.planId}`);
      const snapshot = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["result_status", "completed_at_on_day", "updated_at"].includes(key)));
      for (const before of snapshots) expect(snapshot(after.find((row) => row.id === before.id)!)).toEqual(snapshot(before));
      passed.push(step);

      step = "RLS isolation and rejected direct writes / RPC";
      expect(await rows(b, "reward_events", `source_id=eq.${fa.planId}`)).toEqual([]);
      const forged = await send(apiBase, "/api/commands/task/uncomplete", { method: "POST",
        headers: { Authorization: `Bearer ${b.token}` }, body: JSON.stringify({ date: today, taskId: fa.tasks[3] }) });
      expect(forged.status).toBe(404);
      for (const method of ["POST", "PATCH", "DELETE"]) {
        const response = await send(dbBase, `/rest/v1/reward_events?id=eq.${first.id}`, { method, headers: userHeaders(a),
          body: method === "DELETE" ? undefined : JSON.stringify(method === "POST"
            ? { user_id: a.id, source_type: "DAILY_QUALIFIED", source_id: fa.planId, amount: 1 }
            : { status: "reversed", reversed_at: new Date().toISOString() }) });
        expect([401, 403]).toContain(response.status);
      }
      const rpc = await send(dbBase, "/rest/v1/rpc/sync_daily_reward_event", { method: "POST", headers: userHeaders(a),
        body: JSON.stringify({ p_plan_id: fa.planId, p_user_id: a.id }) });
      expect([401, 403, 404]).toContain(rpc.status);
      expect(await verify(a, fa.planId, true, first)).toEqual(first);
      for (const id of fb.tasks.slice(0, 4)) await execute(b, id, true);
      await verify(b, fb.planId, true);
      expect(await rows(a, "reward_events", `source_id=eq.${fb.planId}`)).toEqual([]);
      passed.push(step);
    } catch {
      failed = true;
      throw new Error(`Daily Reward smoke failed during ${step}; see the non-secret fixture report.`);
    } finally {
      // Delete only newly created, known owners. Plan deletion cascades Items and
      // Rewards BEFORE Tasks are removed (historical Task FK otherwise restricts).
      for (const user of users) {
        let removed = true;
        for (const table of ["daily_plans", "tasks"]) {
          try {
            const response = await send(dbBase, `/rest/v1/${table}?user_id=eq.${user.id}`, { method: "DELETE", headers: adminHeaders }, true);
            if (!response.ok) removed = false;
          } catch { removed = false; }
        }
        try {
          const response = await send(dbBase, `/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: adminHeaders }, true);
          if (!response.ok) removed = false;
        } catch { removed = false; }
        cleanup.push({ userId: user.id, removed });
      }
      const unresolvedEmails = attemptedEmails.filter((email) => !users.some((user) => user.email === email));
      writeFileSync(".env.m2-daily-reward-smoke-result.json", JSON.stringify({ runId, attemptedEmails, unresolvedEmails,
        users: users.map(({ id, email }) => ({ id, email })), passed, failed, step, cleanup }, null, 2));
      expect(cleanup.every((entry) => entry.removed), "all fresh test owners and fixture rows cleaned").toBe(true);
      expect(unresolvedEmails, "uncertain account creation requires lookup by exact test email").toEqual([]);
    }
  }, 300_000);
});

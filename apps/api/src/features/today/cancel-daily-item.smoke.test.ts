import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Same opt-in Vitest/HTTP pattern as M2-03/M2-04. Never installs/pushes SQL.
describe.skipIf(!process.env.CANCEL_DAILY_ITEM_SMOKE_API_BASE_URL)("RP-M2-05 real cancellation Smoke", () => {
  it("preserves daily truth and schedules under retries and competing commands", async () => {
    const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
    const api = required("CANCEL_DAILY_ITEM_SMOKE_API_BASE_URL"), db = required("SUPABASE_URL");
    const anon = required("SUPABASE_ANON_KEY"), secret = required("SUPABASE_SECRET_KEY");
    const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
    expect(JSON.parse(readFileSync("supabase/.temp/linked-project.json", "utf8")).name).toBe("reward-planner-dev");
    expect(new URL(db).hostname).toBe(`${ref}.supabase.co`);
    const apiConfigUrl = /^SUPABASE_URL\s*=\s*["']?([^\s"']+)/m.exec(readFileSync("apps/api/.env.local", "utf8"))?.[1];
    expect(apiConfigUrl && new URL(apiConfigUrl).hostname).toBe(`${ref}.supabase.co`);
    expect(["127.0.0.1", "localhost"].includes(new URL(api).hostname)).toBe(true);
    const runId = randomUUID(), deadline = Date.now() + 180_000, passed: string[] = [], attemptedEmails: string[] = [];
    const owners: { id: string; email: string; token: string }[] = [];
    const cleanup: { userId: string; removed: boolean; counts: Record<string, number> }[] = [];
    const evidence: Record<string, unknown> = {};
    type Owner = typeof owners[number];
    type Row = Record<string, unknown>;
    const admin = { apikey: secret, Authorization: `Bearer ${secret}` }, auth = (owner: Owner) => ({ apikey: anon, Authorization: `Bearer ${owner.token}` });
    let step = "preflight", failed = false;
    const today = new Date().toISOString().slice(0, 10);
    const day = (offset: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
    async function send(base: string, path: string, init: RequestInit = {}, cleaning = false) {
      const timeout = cleaning ? 10_000 : Math.min(15_000, deadline - Date.now());
      if (timeout <= 0) throw new Error("Smoke deadline reached");
      return fetch(new URL(path, base), { ...init, headers: { "Content-Type": "application/json", ...init.headers }, cache: "no-store", signal: AbortSignal.timeout(timeout) });
    }
    async function json<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
      const response = await send(base, path, init); if (!response.ok) throw new Error(`HTTP ${response.status} during ${step}`);
      const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T;
    }
    const rows = (owner: Owner, table: string, filter = "") => json<Row[]>(db, `/rest/v1/${table}?select=*&user_id=eq.${owner.id}&${filter}`, { headers: auth(owner) });
    const post = (owner: Owner, command: string, input: unknown) => send(api, `/api/commands/${command}`, {
      method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: JSON.stringify(input),
    });
    const cancel = (owner: Owner, date: string, itemId: string) => post(owner, "daily-item/cancel", { date, itemId });
    async function success(response: Response) { expect(response.status, step).toBe(200); return await response.json() as { data: Row; effects: string[] }; }
    async function concurrent(actions: Promise<Response>[]) {
      const results = await Promise.allSettled(actions);
      expect(results.every((r) => r.status === "fulfilled"), "all requests drained before cleanup").toBe(true);
      return results.map((r) => (r as PromiseFulfilledResult<Response>).value);
    }
    async function seed(owner: Owner, table: string, data: Row[]) {
      expect(owners.some((o) => o.id === owner.id)).toBe(true); expect(data.every((r) => r.user_id === owner.id)).toBe(true);
      expect(data.every((r) => !["is_qualified", "amount", "completed_item_count", "completion_rate"].some((k) => k in r))).toBe(true);
      await json(db, `/rest/v1/${table}`, { method: "POST", headers: admin, body: JSON.stringify(data) });
    }
    async function owner(label: string) {
      const email = `rp-m2-05-${runId}-${label}@example.test`, password = `${randomBytes(24).toString("base64url")}aA1!`;
      attemptedEmails.push(email);
      const created = await json<{ id: string }>(db, "/auth/v1/admin/users", { method: "POST", headers: admin,
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { purpose: "RP-M2-05 Smoke", run_id: runId } }) });
      const o = { id: created.id, email, token: "" }; owners.push(o);
      o.token = (await json<{ access_token: string }>(db, "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: anon }, body: JSON.stringify({ email, password }) })).access_token;
      await json(db, "/rest/v1/user_settings", { method: "POST", headers: auth(o), body: JSON.stringify({ user_id: o.id, timezone: "UTC" }) }); return o;
    }
    async function plan(o: Owner, date: string, status = "committed") {
      const id = randomUUID(); await seed(o, "daily_plans", [{ id, user_id: o.id, plan_date: date, status, snapshot_created_at: status === "committed" ? new Date().toISOString() : null }]); return id;
    }
    async function task(o: Owner, label: string, completed = false) {
      const id = randomUUID(); await seed(o, "tasks", [{ id, user_id: o.id, title: `RP-M2-05 ${runId} ${label}`, status: completed ? "completed" : "open", completed_at: completed ? new Date().toISOString() : null }]); return id;
    }
    async function item(o: Owner, planId: string, taskId: string, result = "pending", priority = "plan") {
      const id = randomUUID(); await seed(o, "daily_plan_items", [{ id, user_id: o.id, daily_plan_id: planId, task_id: taskId, title_snapshot: `Frozen ${taskId}`, origin: "initial", priority,
        result_status: result, completed_at_on_day: result === "completed" ? new Date().toISOString() : null,
        rescheduled_to_date: result === "rescheduled" ? day(14) : null, planned_start_time_snapshot: "09:00", planned_end_time_snapshot: "10:00" }]); return id;
    }
    async function schedule(o: Owner, taskId: string, date: string | null) {
      await seed(o, "planning_items", [{ user_id: o.id, task_id: taskId, planned_date: date, start_time: "14:00", end_time: "15:00", target_week: day(-7) }]);
    }
    const getItem = async (o: Owner, id: string) => (await rows(o, "daily_plan_items", `id=eq.${id}`))[0];
    const snapshot = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !["result_status", "updated_at"].includes(k)));
    async function cancelAndVerify(o: Owner, date: string, id: string, taskId: string) {
      const before = { item: await getItem(o, id), planning: await rows(o, "planning_items", `task_id=eq.${taskId}`), task: await rows(o, "tasks", `id=eq.${taskId}`),
        plans: await rows(o, "daily_plans", "order=id"), rewards: await rows(o, "reward_events", "order=id") };
      expect((await success(await cancel(o, date, id))).data.changed).toBe(true);
      const after = await getItem(o, id), planning = await rows(o, "planning_items", `task_id=eq.${taskId}`);
      expect(after.result_status).toBe("cancelled"); expect(snapshot(after)).toEqual(snapshot(before.item));
      expect(await rows(o, "tasks", `id=eq.${taskId}`)).toEqual(before.task);
      expect(await rows(o, "daily_plans", "order=id")).toEqual(before.plans); expect(await rows(o, "reward_events", "order=id")).toEqual(before.rewards);
      expect(planning).toHaveLength(before.planning.length);
      if (before.planning[0]?.planned_date === date) {
        expect(planning[0].planned_date).toBeNull();
        const strip = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !["planned_date", "updated_at"].includes(k)));
        expect(strip(planning[0])).toEqual(strip(before.planning[0]));
      } else expect(planning).toEqual(before.planning);
      return { before, after, planning };
    }
    async function consistency(o: Owner, planId: string) {
      const p = (await rows(o, "daily_plans", `id=eq.${planId}`))[0], items = await rows(o, "daily_plan_items", `daily_plan_id=eq.${planId}`);
      const completed = items.filter((i) => i.result_status === "completed").length, must = items.filter((i) => i.priority === "must_do");
      const completedMust = must.filter((i) => i.result_status === "completed").length, qualified = items.length > 0 && completedMust === must.length && completed * 100 >= items.length * 80;
      expect(p).toMatchObject({ total_item_count: items.length, completed_item_count: completed, must_do_item_count: must.length, completed_must_do_item_count: completedMust, is_qualified: qualified });
      const rewards = await rows(o, "reward_events", `source_id=eq.${planId}`); expect(rewards.length).toBeLessThanOrEqual(1);
      if (qualified) expect(rewards).toHaveLength(1);
      if (rewards[0]) expect(rewards[0]).toMatchObject({ amount: 1, status: qualified ? "active" : "reversed" });
      return { plan: p, rewards };
    }
    try {
      const a = await owner("a"), b = await owner("b");
      const probe = await send(db, "/rest/v1/rpc/cancel_daily_item", { method: "POST", headers: auth(a), body: JSON.stringify({ p_date: null, p_item_id: null }) });
      expect(probe.status).toBe(400); expect(await probe.json()).toMatchObject({ code: "22023", message: "INVALID_CANCEL_REQUEST" });
      const current = await plan(a, today), history = await plan(a, day(-7)), future = await plan(a, day(7)), draft = await plan(a, day(8), "draft");
      const currentTask = await task(a, "current"), currentItem = await item(a, current, currentTask); await schedule(a, currentTask, today);
      for (let i = 0; i < 4; i++) await item(a, current, await task(a, `done ${i}`), "completed");
      const originalReward = (await rows(a, "reward_events", `source_id=eq.${current}`))[0];
      const historicalCompletedTask = await task(a, "completed global Task", true), historicalItem = await item(a, history, historicalCompletedTask);
      await schedule(a, historicalCompletedTask, day(-7));
      const otherTask = await task(a, "other schedule"), otherItem = await item(a, history, otherTask); await schedule(a, otherTask, day(7));
      const nullTask = await task(a, "null schedule"), nullItem = await item(a, history, nullTask); await schedule(a, nullTask, null);
      const missingTask = await task(a, "no schedule"), missingItem = await item(a, history, missingTask);
      const futureTask = await task(a, "future Must-do"), futureItem = await item(a, future, futureTask, "pending", "must_do"); await schedule(a, futureTask, day(7));
      const draftItem = await item(a, draft, await task(a, "Draft"));
      const bPlan = await plan(b, today); await item(b, bPlan, await task(b, "owned"));

      step = "current cancellation, 80 percent qualification and reward identity";
      evidence.current = await cancelAndVerify(a, today, currentItem, currentTask);
      expect((await consistency(a, current)).rewards[0]).toEqual(originalReward); passed.push(step);
      step = "historical/global-completed and future/Must-do cancellation";
      evidence.history = await cancelAndVerify(a, day(-7), historicalItem, historicalCompletedTask);
      evidence.future = await cancelAndVerify(a, day(7), futureItem, futureTask); passed.push(step);
      step = "other-date/null/missing Planning preserved";
      await cancelAndVerify(a, day(-7), otherItem, otherTask); await cancelAndVerify(a, day(-7), nullItem, nullTask); await cancelAndVerify(a, day(-7), missingItem, missingTask); passed.push(step);

      step = "repeated/concurrent retries do not clear a newly established schedule";
      const laterHistoryItem = await item(a, history, currentTask);
      await success(await post(a, "task/reschedule", { date: day(-7), taskId: currentTask, targetDate: day(14) }));
      const later = await rows(a, "planning_items", `task_id=eq.${currentTask}`), cancelled = await getItem(a, currentItem);
      const repeated = await concurrent(Array.from({ length: 4 }, () => cancel(a, today, currentItem)));
      for (const reply of repeated) expect((await success(reply)).data.changed).toBe(false);
      expect(await rows(a, "planning_items", `task_id=eq.${currentTask}`)).toEqual(later); expect(await getItem(a, currentItem)).toEqual(cancelled);
      expect((await getItem(a, laterHistoryItem)).result_status).toBe("rescheduled"); passed.push(step);

      step = "concurrent first cancellations clear once";
      const parallelTask = await task(a, "parallel"), parallelItem = await item(a, history, parallelTask); await schedule(a, parallelTask, day(-7));
      const replies = await concurrent(Array.from({ length: 4 }, () => cancel(a, day(-7), parallelItem)));
      const bodies = await Promise.all(replies.map(success)); expect(bodies.filter((r) => r.data.changed)).toHaveLength(1);
      expect((await rows(a, "planning_items", `task_id=eq.${parallelTask}`))[0].planned_date).toBeNull(); passed.push(step);

      step = "Cancel vs Complete has one winner and consistent execution/Planning/reward";
      const executeTask = await task(a, "execution race"), executeItem = await item(a, current, executeTask); await schedule(a, executeTask, today);
      const execution = await concurrent([cancel(a, today, executeItem), post(a, "task/complete", { date: today, taskId: executeTask })]);
      expect(execution.map((r) => r.status).sort()).toEqual([200, 409]);
      const executionRow = await getItem(a, executeItem), taskRow = (await rows(a, "tasks", `id=eq.${executeTask}`))[0], executionPlanning = (await rows(a, "planning_items", `task_id=eq.${executeTask}`))[0];
      if (executionRow.result_status === "cancelled") { expect(taskRow.status).toBe("open"); expect(executionPlanning.planned_date).toBeNull(); }
      else { expect(executionRow.result_status).toBe("completed"); expect(taskRow.status).toBe("completed"); expect(executionPlanning.planned_date).toBe(today); }
      evidence.executionRace = { statuses: execution.map((r) => r.status), item: executionRow, task: taskRow, consistency: await consistency(a, current) }; passed.push(step);

      step = "Cancel vs Reschedule cannot overwrite the winning result";
      const rescheduleTask = await task(a, "reschedule race"), rescheduleItem = await item(a, history, rescheduleTask); await schedule(a, rescheduleTask, day(-7));
      const racing = await concurrent([cancel(a, day(-7), rescheduleItem), post(a, "task/reschedule", { date: day(-7), taskId: rescheduleTask, targetDate: day(14) })]);
      expect(racing.map((r) => r.status).sort()).toEqual([200, 409]);
      const raceItem = await getItem(a, rescheduleItem), racePlanning = (await rows(a, "planning_items", `task_id=eq.${rescheduleTask}`))[0];
      if (raceItem.result_status === "cancelled") expect(racePlanning.planned_date).toBeNull();
      else { expect(raceItem.result_status).toBe("rescheduled"); expect(raceItem.rescheduled_to_date).toBe(day(14)); expect(racePlanning.planned_date).toBe(day(14)); }
      evidence.rescheduleRace = { statuses: racing.map((r) => r.status), item: raceItem, planning: racePlanning, consistency: await consistency(a, history) }; passed.push(step);

      step = "illegal states, Draft, missing resources, ownership and invalid requests";
      for (const state of ["completed", "rescheduled", "incomplete"]) {
        const id = await item(a, history, await task(a, state), state), before = await getItem(a, id), response = await cancel(a, day(-7), id);
        expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "DAILY_ITEM_CANCEL_NOT_ALLOWED" }); expect(await getItem(a, id)).toEqual(before);
      }
      expect((await cancel(a, day(8), draftItem)).status).toBe(409);
      expect((await cancel(a, today, randomUUID())).status).toBe(404); expect((await cancel(a, day(40), currentItem)).status).toBe(404);
      expect((await cancel(a, today, historicalItem)).status).toBe(404); expect((await cancel(a, today, currentTask)).status).toBe(404);
      expect((await cancel(a, "2026-02-30", currentItem)).status).toBe(400); expect((await cancel(b, today, currentItem)).status).toBe(404);
      expect(await json(db, `/rest/v1/daily_plan_items?id=eq.${currentItem}&select=*`, { headers: auth(b) })).toEqual([]);
      passed.push(step);
    } catch {
      failed = true; throw new Error(`Cancel Daily Item Smoke failed during ${step}; inspect its non-secret report.`);
    } finally {
      for (const o of owners) {
        let removed = true; const counts: Record<string, number> = {};
        for (const table of ["daily_plans", "tasks"]) {
          try { if (!(await send(db, `/rest/v1/${table}?user_id=eq.${o.id}`, { method: "DELETE", headers: admin }, true)).ok) removed = false; } catch { removed = false; }
        }
        try { if (!(await send(db, `/auth/v1/admin/users/${o.id}`, { method: "DELETE", headers: admin }, true)).ok) removed = false; } catch { removed = false; }
        const checks = await Promise.allSettled(["profiles", "user_settings", "tasks", "planning_items", "daily_plans", "daily_plan_items", "reward_events"].map(async (table) => {
          const key = table === "profiles" ? "id" : "user_id", response = await send(db, `/rest/v1/${table}?select=${key}&${key}=eq.${o.id}`, { headers: admin }, true);
          if (!response.ok) throw new Error("Cleanup read failed"); counts[table] = (await response.json() as Row[]).length; if (counts[table]) throw new Error("Fixture rows remain");
        }).concat([(async () => { if ((await send(db, `/auth/v1/admin/users/${o.id}`, { headers: admin }, true)).status !== 404) throw new Error("Auth fixture remains"); })()]));
        if (checks.some((r) => r.status === "rejected")) removed = false;
        cleanup.push({ userId: o.id, removed, counts });
      }
      const unresolvedEmails = attemptedEmails.filter((email) => !owners.some((o) => o.email === email));
      writeFileSync(".env.m2-cancel-daily-item-smoke-result.json", JSON.stringify({ runId, failed, step, passed, evidence, attemptedEmails, unresolvedEmails,
        owners: owners.map(({ id, email }) => ({ id, email })), cleanup }, null, 2));
      expect(cleanup.every((c) => c.removed), "all fresh test rows and principals removed").toBe(true); expect(unresolvedEmails).toEqual([]);
    }
  }, 300_000);
});

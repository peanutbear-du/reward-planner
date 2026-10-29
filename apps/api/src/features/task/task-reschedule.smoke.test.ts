import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Separate opt-in after migration Review/application. No SQL/schema operations.
describe.skipIf(!process.env.TASK_RESCHEDULE_SMOKE_API_BASE_URL)("RP-M2-04 real database reschedule smoke", () => {
  it("preserves history and serializes retries, execution and destination membership", async () => {
    const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
    const api = required("TASK_RESCHEDULE_SMOKE_API_BASE_URL"), db = required("SUPABASE_URL");
    const anon = required("SUPABASE_ANON_KEY"), secret = required("SUPABASE_SECRET_KEY");
    expect(["127.0.0.1", "localhost"].includes(new URL(api).hostname)).toBe(true);
    const runId = randomUUID(), deadline = Date.now() + 180_000;
    const owners: { id: string; email: string; token: string }[] = [], attemptedEmails: string[] = [], passed: string[] = [];
    const cleanup: { userId: string; removed: boolean }[] = [];
    const evidence: Record<string, unknown> = {};
    const admin = { apikey: secret, Authorization: `Bearer ${secret}` };
    type Owner = typeof owners[number];
    type Row = Record<string, unknown>;
    let step = "schema preflight", failed = false;
    const today = new Date().toISOString().slice(0, 10);
    function day(offset: number) { const value = new Date(`${today}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
    const auth = (owner: Owner) => ({ apikey: anon, Authorization: `Bearer ${owner.token}` });
    async function send(base: string, path: string, init: RequestInit = {}, cleaning = false) {
      const timeout = cleaning ? 10_000 : Math.min(15_000, deadline - Date.now());
      if (timeout <= 0) throw new Error("Smoke deadline reached");
      const response = await fetch(new URL(path, base), { ...init, cache: "no-store", signal: AbortSignal.timeout(timeout),
        headers: { "Content-Type": "application/json", ...init.headers } });
      return response;
    }
    async function json<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
      const response = await send(base, path, init);
      if (!response.ok) throw new Error(`HTTP ${response.status} during ${step}`);
      const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T;
    }
    const rows = (owner: Owner, table: string, filter = "") => json<Row[]>(db, `/rest/v1/${table}?select=*&user_id=eq.${owner.id}&${filter}`, { headers: auth(owner) });
    const post = (owner: Owner, command: string, input: unknown) => send(api, `/api/commands/${command}`, {
      method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: JSON.stringify(input),
    });
    const reschedule = (owner: Owner, taskId: string, date: string, targetDate: string) => post(owner, "task/reschedule", { date, taskId, targetDate });
    async function successful(response: Response) { expect(response.status, step).toBe(200); return await response.json() as { data: Row; effects: string[] }; }
    async function concurrent(actions: Promise<Response>[]) {
      const settled = await Promise.allSettled(actions);
      expect(settled.every((entry) => entry.status === "fulfilled"), "all requests settled without transport failure").toBe(true);
      return settled.map((entry) => (entry as PromiseFulfilledResult<Response>).value);
    }
    async function seed(owner: Owner, table: string, data: Row[]) {
      expect(owners.some((entry) => entry.id === owner.id)).toBe(true);
      expect(data.every((entry) => entry.user_id === owner.id)).toBe(true);
      expect(data.every((entry) => !["is_qualified", "amount", "completion_rate", "completed_item_count"].some((key) => key in entry))).toBe(true);
      await json(db, `/rest/v1/${table}`, { method: "POST", headers: admin, body: JSON.stringify(data) });
    }
    async function owner(label: string) {
      const email = `rp-m2-04-${runId}-${label}@example.test`, password = `${randomBytes(24).toString("base64url")}aA1!`;
      attemptedEmails.push(email);
      const created = await json<{ id: string }>(db, "/auth/v1/admin/users", { method: "POST", headers: admin,
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { purpose: "RP-M2-04 smoke", run_id: runId } }) });
      const value = { id: created.id, email, token: "" }; owners.push(value);
      value.token = (await json<{ access_token: string }>(db, "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: anon }, body: JSON.stringify({ email, password }) })).access_token;
      await json(db, "/rest/v1/user_settings", { method: "POST", headers: auth(value), body: JSON.stringify({ user_id: value.id, timezone: "UTC" }) });
      return value;
    }
    async function task(owner: Owner, label: string) {
      const id = randomUUID(); await seed(owner, "tasks", [{ id, user_id: owner.id, title: `RP-M2-04 ${runId} ${label}` }]); return id;
    }
    async function plan(owner: Owner, date: string, status = "committed") {
      const id = randomUUID(); await seed(owner, "daily_plans", [{ id, user_id: owner.id, plan_date: date, status, snapshot_created_at: status === "committed" ? new Date().toISOString() : null }]); return id;
    }
    async function item(owner: Owner, planId: string, taskId: string, resultStatus = "pending") {
      const id = randomUUID(); await seed(owner, "daily_plan_items", [{ id, user_id: owner.id, daily_plan_id: planId, task_id: taskId, title_snapshot: `Frozen ${taskId}`,
        origin: "initial", priority: "plan", result_status: resultStatus, completed_at_on_day: resultStatus === "completed" ? new Date().toISOString() : null,
        planned_start_time_snapshot: "09:00", planned_end_time_snapshot: "10:00" }]); return id;
    }
    const getItem = async (owner: Owner, taskId: string, planId: string) => (await rows(owner, "daily_plan_items", `task_id=eq.${taskId}&daily_plan_id=eq.${planId}`))[0];
    const snapshot = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["result_status", "rescheduled_to_date", "updated_at"].includes(key)));
    try {
      await json(db, "/rest/v1/reward_events?select=id&limit=0", { headers: admin });
      const a = await owner("a"), b = await owner("b");
      // Probe the real authenticated RPC, not optional OpenAPI metadata. Invalid
      // null context is rejected before settings/locks/writes by this function.
      step = "authenticated RPC preflight";
      const probe = await send(db, "/rest/v1/rpc/reschedule_task", { method: "POST", headers: auth(a),
        body: JSON.stringify({ p_date: null, p_task_id: null, p_target_date: null }) });
      const probeBody = await probe.json() as { code?: string; message?: string };
      evidence.rpcPreflight = { status: probe.status, code: probeBody.code, message: probeBody.message };
      expect(probe.status).toBe(400);
      expect(probeBody).toMatchObject({ code: "22023", message: "INVALID_RESCHEDULE_DATE" });
      const history = await plan(a, day(-1)), current = await plan(a, today);
      const destination = await plan(a, day(1), "draft");
      const targetOther = await task(a, "unrelated destination Task"); await item(a, destination, targetOther);
      const pending = await task(a, "execution race"); await item(a, current, pending);
      for (let i = 0; i < 4; i++) { const id = await task(a, `completed ${i}`); await item(a, current, id, "completed"); }
      const historyTasks: string[] = [];
      for (let i = 0; i < 3; i++) { const id = await task(a, `history ${i}`); await item(a, history, id); historyTasks.push(id); }
      const source = historyTasks[0];
      await seed(a, "planning_items", [{ user_id: a.id, task_id: source, planned_date: day(-1), start_time: "14:00", end_time: "15:00" }]);
      const bPlan = await plan(b, today), bTask = await task(b, "own Task"); await item(b, bPlan, bTask);
      const originalTaskCount = (await rows(a, "tasks")).length;
      const before = await getItem(a, source, history), plansBefore = await rows(a, "daily_plans", "order=id");
      const originalReward = (await rows(a, "reward_events", `source_id=eq.${current}`))[0];

      step = "same-target concurrent retries and untouched destination Draft";
      const replies = await concurrent(Array.from({ length: 4 }, () => reschedule(a, source, day(-1), day(1))));
      const bodies = await Promise.all(replies.map(successful));
      expect(bodies.filter((reply) => reply.data.changed)).toHaveLength(1);
      const saved = await getItem(a, source, history);
      expect(saved).toMatchObject({ result_status: "rescheduled", rescheduled_to_date: day(1) });
      expect(snapshot(saved)).toEqual(snapshot(before));
      expect(await rows(a, "daily_plans", "order=id")).toEqual(plansBefore);
      expect(await rows(a, "daily_plan_items", `daily_plan_id=eq.${destination}&task_id=eq.${source}`)).toEqual([]);
      expect((await rows(a, "planning_items", `task_id=eq.${source}`))[0]).toMatchObject({ planned_date: day(1), start_time: "14:00:00", end_time: "15:00:00" });
      expect(await getItem(a, source, history)).toEqual(saved);
      expect((await reschedule(a, source, day(-1), day(2))).status).toBe(409);
      evidence.history = { before, after: saved, planning: await rows(a, "planning_items", `task_id=eq.${source}`), destinationPlanId: destination };
      passed.push(step);

      step = "different-target race creates one schedule and no destination Plan";
      const conflicting = await concurrent([reschedule(a, historyTasks[1], day(-1), day(2)), reschedule(a, historyTasks[1], day(-1), day(3))]);
      expect(conflicting.map((reply) => reply.status).sort()).toEqual([200, 409]);
      const winner = await getItem(a, historyTasks[1], history);
      expect((await rows(a, "planning_items", `task_id=eq.${historyTasks[1]}`))[0].planned_date).toBe(winner.rescheduled_to_date);
      expect(await rows(a, "daily_plans", "order=id")).toEqual(plansBefore);
      passed.push(step);

      step = "Complete vs Reschedule race is atomic and preserves the Daily reward";
      const execution = await concurrent([reschedule(a, pending, today, day(2)), post(a, "task/complete", { date: today, taskId: pending })]);
      expect(execution.map((reply) => reply.status).sort()).toEqual([200, 409]);
      const executionItem = await getItem(a, pending, current), global = (await rows(a, "tasks", `id=eq.${pending}`))[0];
      if (executionItem.result_status === "rescheduled") {
        expect(global.status).toBe("open"); expect((await rows(a, "planning_items", `task_id=eq.${pending}`))[0].planned_date).toBe(day(2));
      } else { expect(executionItem.result_status).toBe("completed"); expect(global.status).toBe("completed"); expect(await rows(a, "planning_items", `task_id=eq.${pending}`)).toEqual([]); }
      expect((await rows(a, "reward_events", `source_id=eq.${current}`))[0]).toEqual(originalReward);
      expect((await rows(a, "daily_plans", `id=eq.${current}`))[0]).toMatchObject({ total_item_count: 5, is_qualified: true });
      evidence.executionRace = { statuses: execution.map((reply) => reply.status), item: executionItem, taskStatus: global.status,
        plan: (await rows(a, "daily_plans", `id=eq.${current}`))[0], reward: (await rows(a, "reward_events", `source_id=eq.${current}`))[0] };
      passed.push(step);

      step = "destination Draft insertion vs Reschedule avoids deadlock/overwrite";
      const raceTask = historyTasks[2];
      const destinationRace = await concurrent([reschedule(a, raceTask, day(-1), day(1)), post(a, "today/draft/upsert-item", { date: day(1), taskId: raceTask, priority: "plan" })]);
      expect(destinationRace[1].status).toBe(200);
      expect([200, 409]).toContain(destinationRace[0].status);
      const raceItem = await getItem(a, raceTask, history), racePlanning = await rows(a, "planning_items", `task_id=eq.${raceTask}`);
      if (destinationRace[0].status === 200) { expect(raceItem.result_status).toBe("rescheduled"); expect(racePlanning[0].planned_date).toBe(day(1)); }
      else { expect(raceItem.result_status).toBe("pending"); expect(racePlanning).toEqual([]); }
      passed.push(step);

      step = "later Task completion preserves original historical Item";
      await successful(await post(a, "today/add-later", { date: today, taskId: source, priority: "plan" }));
      await successful(await post(a, "task/complete", { date: today, taskId: source }));
      await successful(await post(a, "task/uncomplete", { date: today, taskId: source }));
      expect(await getItem(a, source, history)).toEqual(saved);
      expect((await successful(await reschedule(a, source, day(-1), day(1)))).data.changed).toBe(false);
      passed.push(step);

      step = "ownership, invalid dates and no duplicate Tasks";
      expect((await reschedule(b, pending, today, day(2))).status).toBe(404);
      expect(await json(db, `/rest/v1/daily_plan_items?select=*&daily_plan_id=eq.${history}`, { headers: auth(b) })).toEqual([]);
      const stillPending = await task(a, "invalid dates"); await item(a, history, stillPending);
      const invalidBefore = await getItem(a, stillPending, history);
      expect((await reschedule(a, stillPending, day(-1), today)).status).toBe(400);
      expect((await reschedule(a, stillPending, day(-1), "2026-02-30")).status).toBe(400);
      expect(await getItem(a, stillPending, history)).toEqual(invalidBefore);
      expect((await rows(a, "tasks")).length).toBe(originalTaskCount + 1); // Only this explicit fixture Task was added.
      passed.push(step);

      step = "intervening third-date schedule is rejected without partial writes";
      await seed(a, "planning_items", [{ user_id: a.id, task_id: stillPending, planned_date: day(5), start_time: "11:00", end_time: "12:00" }]);
      const thirdDateBefore = await rows(a, "planning_items", `task_id=eq.${stillPending}`);
      const thirdDateReply = await reschedule(a, stillPending, day(-1), day(2));
      expect(thirdDateReply.status).toBe(409);
      expect(await thirdDateReply.json()).toEqual({ error: "RESCHEDULE_PLANNING_CONFLICT" });
      expect(await getItem(a, stillPending, history)).toEqual(invalidBefore);
      expect(await rows(a, "planning_items", `task_id=eq.${stillPending}`)).toEqual(thirdDateBefore);
      evidence.thirdDate = { itemId: invalidBefore.id, planning: thirdDateBefore, rejectedTarget: day(2) };
      passed.push(step);

      step = "completed and cancelled Items and completed global Task are rejected";
      const illegalStates: Record<string, unknown>[] = [];
      for (const state of ["completed", "cancelled"]) {
        const id = await task(a, `illegal ${state}`); await item(a, history, id, state);
        const beforeItem = await getItem(a, id, history);
        const response = await reschedule(a, id, day(-1), day(2));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: "DAILY_ITEM_RESCHEDULE_NOT_ALLOWED" });
        expect(await getItem(a, id, history)).toEqual(beforeItem);
        expect(await rows(a, "planning_items", `task_id=eq.${id}`)).toEqual([]);
        illegalStates.push({ taskId: id, resultStatus: state, rejected: true });
      }
      // Complete through the existing Business API, retaining its real global
      // status; the same Task's pending historical relation must also refuse.
      const completedTask = await task(a, "globally completed"); await item(a, history, completedTask);
      await successful(await post(a, "today/add-later", { date: today, taskId: completedTask, priority: "plan" }));
      await successful(await post(a, "task/complete", { date: today, taskId: completedTask }));
      const pendingHistory = await getItem(a, completedTask, history);
      const completedResponse = await reschedule(a, completedTask, day(-1), day(2));
      expect(completedResponse.status).toBe(409);
      expect(await completedResponse.json()).toEqual({ error: "TASK_RESCHEDULE_NOT_ALLOWED" });
      expect(await getItem(a, completedTask, history)).toEqual(pendingHistory);
      expect(await rows(a, "planning_items", `task_id=eq.${completedTask}`)).toEqual([]);
      evidence.illegalStates = [...illegalStates, { taskId: completedTask, globalStatus: "completed", rejected: true }];
      passed.push(step);
    } catch {
      failed = true; throw new Error(`Reschedule Smoke failed during ${step}; inspect its non-secret report.`);
    } finally {
      for (const owner of owners) {
        let removed = true;
        for (const table of ["daily_plans", "tasks"]) {
          try { if (!(await send(db, `/rest/v1/${table}?user_id=eq.${owner.id}`, { method: "DELETE", headers: admin }, true)).ok) removed = false; }
          catch { removed = false; }
        }
        try { if (!(await send(db, `/auth/v1/admin/users/${owner.id}`, { method: "DELETE", headers: admin }, true)).ok) removed = false; }
        catch { removed = false; }
        cleanup.push({ userId: owner.id, removed });
      }
      const unresolvedEmails = attemptedEmails.filter((email) => !owners.some((owner) => owner.email === email));
      writeFileSync(".env.m2-reschedule-smoke-result.json", JSON.stringify({ runId, failed, step, passed, evidence, attemptedEmails, unresolvedEmails,
        owners: owners.map(({ id, email }) => ({ id, email })), cleanup }, null, 2));
      expect(cleanup.every((entry) => entry.removed), "fresh fixtures cleaned").toBe(true);
      expect(unresolvedEmails, "uncertain account creation must be resolved by exact email").toEqual([]);
    }
  }, 300_000);
});

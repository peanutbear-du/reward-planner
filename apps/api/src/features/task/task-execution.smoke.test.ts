import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { AddLaterResponse, CommitDailyPlanResponse, CreateTaskResponse, TaskExecutionResponse, TodayResponse, UpsertDraftTodayItemResponse } from "@reward-planner/types";
import { describe, expect, it } from "vitest";

// Explicit opt-in only. Reuses the existing live-smoke HTTP pattern, but creates
// independent users and NEVER deletes Tasks, Plans, Items or auth owners.
const qualificationMode = Boolean(process.env.DAILY_QUALIFICATION_SMOKE_API_BASE_URL);
const ticket = qualificationMode ? "RP-M2-02" : "RP-M2-01";
describe.skipIf(!process.env.TASK_EXECUTION_SMOKE_API_BASE_URL && !qualificationMode)(`${ticket} real database smoke`, () => {
  it("persists execution with idempotency, date guards, history and ownership", async () => {
    const apiBase = required(qualificationMode ? "DAILY_QUALIFICATION_SMOKE_API_BASE_URL" : "TASK_EXECUTION_SMOKE_API_BASE_URL");
    const supabaseBase = required("SUPABASE_URL");
    const anonKey = required("SUPABASE_ANON_KEY");
    const secretKey = required("SUPABASE_SECRET_KEY");
    expect(["127.0.0.1", "localhost"].includes(new URL(apiBase).hostname), "only the locally configured API is used").toBe(true);
    const deadline = Date.now() + 8 * 60_000;
    const runId = randomUUID();
    const users: SmokeUser[] = [];
    const tasks: { owner: string; id: string; kind: string }[] = [];
    const plans: { owner: string; id: string; date: string }[] = [];
    const passed: string[] = [];
    const cleanup: { userId: string; sessionRevoked: boolean; accountDisabled: boolean }[] = [];
    const qualificationEvidence: Record<string, unknown> = {};
    let step = "preflight";
    let today = "";
    let failure: Error | undefined;
    const adminHeaders = { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
    const userHeaders = (user: SmokeUser) => ({ apikey: anonKey, Authorization: `Bearer ${user.token}` });
    const apiHeaders = (user: SmokeUser) => ({ Authorization: `Bearer ${user.token}` });
    const pass = (name: string) => { passed.push(name); console.info(`PASS: ${name}`); };

    async function send(base: string, path: string, init: RequestInit = {}, cleanupRequest = false) {
      const remaining = cleanupRequest ? 20_000 : deadline - Date.now();
      if (remaining <= 0) throw new Error("Smoke execution deadline reached.");
      try {
        return await fetch(new URL(path, base), {
          ...init, cache: "no-store",
          headers: { "Content-Type": "application/json", "User-Agent": `RewardPlanner-${ticket}-Smoke/1.0`, ...init.headers },
          signal: AbortSignal.timeout(Math.min(20_000, remaining)),
        });
      } catch { throw new Error(`Smoke network failure during ${step}.`); }
    }
    async function json<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
      const response = await send(base, path, init);
      if (!response.ok) throw new Error(`Smoke HTTP ${response.status} during ${step}.`);
      const body = await response.text();
      return (body ? JSON.parse(body) : undefined) as T;
    }
    const post = <T>(user: SmokeUser, path: string, input: unknown) => json<T>(apiBase, `/api/commands/${path}`, {
      method: "POST", headers: apiHeaders(user), body: JSON.stringify(input),
    });
    const query = (user: SmokeUser, date: string) => json<TodayResponse>(apiBase, `/api/today?date=${date}`, { headers: apiHeaders(user) });
    const rows = (user: SmokeUser, table: string, filters: string) => json<Row[]>(supabaseBase,
      `/rest/v1/${table}?user_id=eq.${user.id}&${filters}`, { headers: userHeaders(user) });
    async function state(user: SmokeUser, taskId: string, date: string) {
      const [taskRows, planRows] = await Promise.all([
        rows(user, "tasks", `id=eq.${taskId}&select=*`), rows(user, "daily_plans", `plan_date=eq.${date}&select=*`),
      ]);
      expect(taskRows.length === 1 && planRows.length === 1, "owned Task and Plan exist").toBe(true);
      const itemRows = await rows(user, "daily_plan_items", `daily_plan_id=eq.${planRows[0].id}&task_id=eq.${taskId}&select=*`);
      expect(itemRows.length, "exactly one Task relation").toBe(1);
      return { task: taskRows[0], plan: planRows[0], item: itemRows[0] };
    }
    async function createUser(label: string): Promise<SmokeUser> {
      const email = `${ticket.toLowerCase()}-${runId}-${label}@example.test`;
      const password = `${randomBytes(28).toString("base64url")}aA1!`;
      const created = await json<{ id: string }>(supabaseBase, "/auth/v1/admin/users", {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { purpose: `${ticket} smoke`, run_id: runId } }),
      });
      const user: SmokeUser = { id: created.id, email, token: "" };
      users.push(user); // Retain identity even if the subsequent login fails.
      const auth = await json<{ access_token: string; user: { id: string } }>(supabaseBase, "/auth/v1/token?grant_type=password", {
        method: "POST", headers: { apikey: anonKey }, body: JSON.stringify({ email, password }),
      });
      expect(auth.user.id, "session belongs to the newly created test user").toBe(created.id);
      user.token = auth.access_token;
      await json(supabaseBase, "/rest/v1/user_settings", {
        method: "POST", headers: userHeaders(user), body: JSON.stringify({ user_id: user.id, timezone: "Asia/Shanghai" }),
      });
      return user;
    }
    async function createTask(user: SmokeUser, kind: string, timed = false) {
      const response = await post<CreateTaskResponse>(user, "task/create", {
        title: `${ticket} ${runId.slice(0, 8)} ${kind}`,
        schedule: timed ? { plannedDate: today, startTime: "09:00", endTime: "10:00" } : null,
      });
      tasks.push({ owner: user.id, id: response.data.task.id, kind });
      return response.data.task.id;
    }
    async function draft(user: SmokeUser, date: string, taskId: string) {
      const result = await post<UpsertDraftTodayItemResponse>(user, "today/draft/upsert-item", { date, taskId, priority: "must_do" });
      if (!plans.some((plan) => plan.id === result.data.dailyPlanId)) plans.push({ owner: user.id, id: result.data.dailyPlanId, date });
      return result;
    }
    async function commit(user: SmokeUser, date: string) {
      const result = await post<CommitDailyPlanResponse>(user, "today/commit", { date });
      expect(result.data.dailyPlan.status, "plan committed").toBe("committed");
    }
    async function reject(user: SmokeUser, taskId: string, date: string, status: number, code: string) {
      for (const action of ["complete", "uncomplete"]) {
        const response = await send(apiBase, `/api/commands/task/${action}`, {
          method: "POST", headers: apiHeaders(user), body: JSON.stringify({ taskId, date }),
        });
        expect(response.status, `${action}: ${code}`).toBe(status);
        const body = await response.json() as { error: string };
        expect(body.error, "controlled domain error").toBe(code);
      }
    }
    function assertExecution(value: Awaited<ReturnType<typeof state>>, completed: boolean) {
      expect(value.task.status, "global Task status").toBe(completed ? "completed" : "open");
      expect(value.item.result_status, "target Daily Item status").toBe(completed ? "completed" : "pending");
      expect(completed ? typeof value.task.completed_at === "string" : value.task.completed_at === null, "global completion time").toBe(true);
      expect(completed ? typeof value.item.completed_at_on_day === "string" : value.item.completed_at_on_day === null, "day completion time").toBe(true);
    }

    async function smokeQualification(a: SmokeUser, b: SmokeUser) {
      // Privileged INSERTs below seed only these newly created accounts. No
      // aggregate field is supplied, and all transitions use the Business API.
      async function seed(user: SmokeUser, table: "tasks" | "daily_plans" | "daily_plan_items", input: Row[]) {
        expect(users.some((entry) => entry.id === user.id)).toBe(true);
        expect(input.every((row) => row.user_id === user.id)).toBe(true);
        expect(input.every((row) => !["is_qualified", "qualified_at", "total_item_count", "completed_item_count", "completion_rate"].some((key) => key in row))).toBe(true);
        await json(supabaseBase, `/rest/v1/${table}`, { method: "POST", headers: adminHeaders, body: JSON.stringify(input) });
      }
      async function plan(user: SmokeUser, date: string) {
        const id = randomUUID();
        plans.push({ owner: user.id, id, date });
        await seed(user, "daily_plans", [{ id, user_id: user.id, plan_date: date, status: "committed", snapshot_created_at: new Date().toISOString() }]);
        return id;
      }
      async function items(user: SmokeUser, planId: string, count: number, completed: number, mustDoIndex = -1) {
        const doneAt = new Date(Date.now() - 60_000).toISOString();
        const seeded = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), user_id: user.id,
          title: `${ticket} ${runId.slice(0, 8)} fixture ${index + 1}`,
          status: index < completed ? "completed" : "open", completed_at: index < completed ? doneAt : null }));
        tasks.push(...seeded.map((task) => ({ owner: user.id, id: task.id, kind: "threshold fixture" })));
        await seed(user, "tasks", seeded);
        await seed(user, "daily_plan_items", seeded.map((task, index) => ({ id: randomUUID(), user_id: user.id,
          daily_plan_id: planId, task_id: task.id, title_snapshot: task.title, origin: "initial",
          priority: index === mustDoIndex ? "must_do" : "plan", result_status: index < completed ? "completed" : "pending",
          completed_at_on_day: task.completed_at, planned_start_time_snapshot: "09:00", planned_end_time_snapshot: "10:00" })));
        return seeded.map((task) => task.id);
      }
      async function verify(user: SmokeUser, expected: Record<string, unknown>) {
        const [fresh, persisted] = await Promise.all([query(user, today), rows(user, "daily_plans", `plan_date=eq.${today}&select=*`)]);
        expect(persisted).toHaveLength(1);
        const row = persisted[0];
        expect(fresh.dailyStatus).toEqual({ available: true, totalItems: row.total_item_count,
          completedItems: row.completed_item_count, mustDoItems: row.must_do_item_count,
          completedMustDoItems: row.completed_must_do_item_count, completionRate: row.completion_rate,
          isQualified: row.is_qualified, qualifiedAt: row.qualified_at, calculatedAt: row.qualification_calculated_at });
        expect(fresh.dailyStatus).toMatchObject(expected);
        if (!fresh.dailyStatus.available) throw new Error("Committed Daily Status unavailable.");
        expect(typeof fresh.dailyStatus.calculatedAt).toBe("string");
        expect(fresh.dailyStatus.isQualified ? typeof fresh.dailyStatus.qualifiedAt === "string" : fresh.dailyStatus.qualifiedAt === null).toBe(true);
        return { status: fresh.dailyStatus, plan: row };
      }
      async function execute(user: SmokeUser, taskId: string, completed: boolean) {
        const response = await post<TaskExecutionResponse>(user, completed ? "task/complete" : "task/uncomplete", { date: today, taskId });
        expect(response.effects.every((effect) => effect === "task_completed" || effect === "task_uncompleted")).toBe(true);
        return response;
      }
      step = "qualification schema and empty fixtures";
      const schema = await json<{ paths: Record<string, unknown> }>(supabaseBase, "/rest/v1/", {
        headers: { ...adminHeaders, Accept: "application/openapi+json" },
      });
      const rewardTable = Object.hasOwn(schema.paths, "/reward_events");
      const calendarTable = Object.hasOwn(schema.paths, "/calendar_events");
      qualificationEvidence.calendarEvents = { tablePresent: calendarTable, entityFixtureExecuted: false,
        scope: "Calendar Event entity is not implemented; actual schedule-only Task exclusion is tested." };
      async function rewards() {
        if (!rewardTable) return [];
        return json<Row[]>(supabaseBase, `/rest/v1/reward_events?user_id=in.(${a.id},${b.id})&select=*`, { headers: adminHeaders });
      }
      const rewardsBefore = await rewards();
      expect(rewardsBefore).toEqual([]);
      const bPlan = await plan(b, today);
      const emptyStatus = await verify(b, { totalItems: 0, completedItems: 0, completionRate: 0, mustDoItems: 0, isQualified: false, qualifiedAt: null });
      qualificationEvidence.empty = emptyStatus.status;
      pass("N_zero_committed_plan_is_unqualified_and_persisted");

      step = "79 percent fixture and historical snapshot";
      const aPlan = await plan(a, today);
      const ids = await items(a, aPlan, 100, 79);
      const past = shiftDate(today, -1);
      const historyPlan = await plan(a, past);
      await seed(a, "daily_plan_items", [{ id: randomUUID(), user_id: a.id, daily_plan_id: historyPlan,
        task_id: ids[79], origin: "initial", priority: "plan", title_snapshot: "Frozen historical title",
        planned_start_time_snapshot: "07:00", planned_end_time_snapshot: "08:00", result_status: "completed",
        completed_at_on_day: `${past}T01:00:00Z` }]);
      const historyBefore = { plans: await rows(a, "daily_plans", `id=eq.${historyPlan}&select=*`),
        items: await rows(a, "daily_plan_items", `daily_plan_id=eq.${historyPlan}&select=*`) };
      const initialItems = await rows(a, "daily_plan_items", `daily_plan_id=eq.${aPlan}&order=id&select=*`);
      const initialPlan = planSnapshot((await rows(a, "daily_plans", `id=eq.${aPlan}&select=*`))[0]);
      qualificationEvidence.seventyNine = (await verify(a, { totalItems: 100, completedItems: 79, completionRate: 79,
        mustDoItems: 0, completedMustDoItems: 0, isQualified: false })).status;
      pass("79_percent_without_must_do_is_unqualified");

      step = "schedule exclusion";
      await createTask(a, "Schedule only", true);
      expect((await query(a, today)).schedule.timedTasks.some((task) => !task.countsTowardDaily)).toBe(true);
      expect((await query(a, today)).schedule.calendarEvents).toEqual([]);
      await verify(a, { totalItems: 100, completedItems: 79, completionRate: 79 });
      pass("schedule_only_task_excluded_and_calendar_schema_boundary_recorded");

      step = "80 percent and persisted time transitions";
      await execute(a, ids[79], true);
      const qualified = await verify(a, { totalItems: 100, completedItems: 80, completionRate: 80, isQualified: true });
      qualificationEvidence.eighty = qualified.status;
      const duplicate = await Promise.all([execute(a, ids[79], true), execute(a, ids[79], true)]);
      expect(duplicate.every((result) => !result.data.changed)).toBe(true);
      expect(canonical((await verify(a, { isQualified: true })).plan)).toBe(canonical(qualified.plan));
      await execute(a, ids[80], true);
      expect((await verify(a, { completedItems: 81, isQualified: true })).status.qualifiedAt).toBe(qualified.status.qualifiedAt);
      await execute(a, ids[80], false);
      expect((await verify(a, { completedItems: 80, isQualified: true })).status.qualifiedAt).toBe(qualified.status.qualifiedAt);
      pass("80_percent_qualifies_and_true_to_true_preserves_qualified_at");

      const undos = await Promise.all([execute(a, ids[79], false), execute(a, ids[79], false)]);
      expect(undos.filter((result) => result.data.changed)).toHaveLength(1);
      const undone = await verify(a, { completedItems: 79, completionRate: 79, isQualified: false, qualifiedAt: null });
      await Promise.all([execute(a, ids[79], false), execute(a, ids[79], false)]);
      expect(canonical((await verify(a, { isQualified: false })).plan)).toBe(canonical(undone.plan));
      await execute(a, ids[79], true);
      expect((await verify(a, { isQualified: true })).status.qualifiedAt).not.toBe(qualified.status.qualifiedAt);
      pass("uncomplete_reverses_and_duplicate_concurrent_operations_preserve_all_plan_times");

      step = "Added Later denominator and concurrent updates";
      const later = await createTask(a, "Added Later denominator");
      const additions = await Promise.all([0, 1].map(() => post<AddLaterResponse>(a, "today/add-later", { date: today, taskId: later, priority: "plan" })));
      expect(additions[0]).toEqual(additions[1]);
      qualificationEvidence.denominatorReversal = (await verify(a, { totalItems: 101, completedItems: 80,
        completionRate: 79.2, isQualified: false, qualifiedAt: null })).status;
      const beforeRetry = await verify(a, { totalItems: 101 });
      await post(a, "today/add-later", { date: today, taskId: later, priority: "plan" });
      expect(canonical((await verify(a, { totalItems: 101 })).plan)).toBe(canonical(beforeRetry.plan));
      await Promise.all([execute(a, later, true), execute(a, ids[80], true)]);
      await verify(a, { totalItems: 101, completedItems: 82, completionRate: 81.18, isQualified: true });
      await Promise.all([execute(a, later, false), execute(a, ids[80], false)]);
      await verify(a, { totalItems: 101, completedItems: 80, completionRate: 79.2, isQualified: false });
      const laterMust = await createTask(a, "Added Later Must-do");
      await Promise.all([
        post(a, "today/add-later", { date: today, taskId: laterMust, priority: "must_do" }),
        execute(a, later, true),
      ]);
      await execute(a, ids[80], true);
      await verify(a, { totalItems: 102, completedItems: 82, completionRate: 80.39,
        mustDoItems: 1, completedMustDoItems: 0, isQualified: false });
      await execute(a, laterMust, true);
      await verify(a, { totalItems: 102, completedItems: 83, completedMustDoItems: 1, isQualified: true });
      await Promise.all([execute(a, ids[80], false), execute(a, laterMust, false)]);
      await verify(a, { totalItems: 102, completedItems: 81, isQualified: false });
      pass("initial_and_added_later_denominator_reversal_retry_and_concurrency");
      pass("added_later_must_do_blocks_even_above_80_percent");

      step = "initial Must-do at 80 percent";
      const bIds = await items(b, bPlan, 5, 4, 4);
      qualificationEvidence.mustDoBlocks = (await verify(b, { totalItems: 5, completedItems: 4, completionRate: 80,
        mustDoItems: 1, completedMustDoItems: 0, isQualified: false })).status;
      await execute(b, bIds[4], true);
      const allDone = await verify(b, { completedItems: 5, completionRate: 100, completedMustDoItems: 1, isQualified: true });
      await execute(b, bIds[0], false);
      expect((await verify(b, { completedItems: 4, completionRate: 80, completedMustDoItems: 1, isQualified: true })).status.qualifiedAt).toBe(allDone.status.qualifiedAt);
      await execute(b, bIds[4], false);
      await verify(b, { completedItems: 3, completionRate: 60, completedMustDoItems: 0, isQualified: false, qualifiedAt: null });
      pass("initial_must_do_incomplete_blocks_and_completion_uncompletion_reverses");

      step = "history and basic ownership isolation";
      expect({ plans: await rows(a, "daily_plans", `id=eq.${historyPlan}&select=*`),
        items: await rows(a, "daily_plan_items", `daily_plan_id=eq.${historyPlan}&select=*`) }).toEqual(historyBefore);
      const afterItems = await rows(a, "daily_plan_items", `daily_plan_id=eq.${aPlan}&origin=eq.initial&order=id&select=*`);
      expect(afterItems.map(snapshot)).toEqual(initialItems.map(snapshot));
      expect(planSnapshot((await rows(a, "daily_plans", `id=eq.${aPlan}&select=*`))[0])).toEqual(initialPlan);
      expect((await query(a, past)).dailyStatus).toMatchObject({ available: true, totalItems: 1, completedItems: 1, isQualified: true });
      expect(await json(supabaseBase, `/rest/v1/daily_plans?id=eq.${aPlan}&select=*`, { headers: userHeaders(b) })).toEqual([]);
      expect(await json(supabaseBase, `/rest/v1/daily_plan_items?daily_plan_id=eq.${aPlan}&select=*`, { headers: userHeaders(b) })).toEqual([]);
      const aBefore = (await verify(a, {})).plan, bBefore = (await verify(b, {})).plan;
      const foreign = await send(apiBase, "/api/commands/task/complete", { method: "POST", headers: apiHeaders(b), body: JSON.stringify({ date: today, taskId: ids[79] }) });
      expect(foreign.status).toBe(404);
      expect((await foreign.json() as { error: string }).error).toBe("TASK_NOT_FOUND");
      expect((await verify(a, {})).plan).toEqual(aBefore);
      expect((await verify(b, {})).plan).toEqual(bBefore);
      pass("historical_result_title_time_snapshot_and_basic_ownership_preserved");

      step = "no Reward Event and fixture inventory";
      expect(await rewards()).toEqual(rewardsBefore);
      qualificationEvidence.rewardEvents = { tablePresent: rewardTable, before: rewardsBefore.length, after: 0,
        basis: rewardTable ? "privileged reads restricted to both fresh test owners" : "reward_events is absent from privileged REST schema; no reward storage exists yet" };
      qualificationEvidence.inventory = await Promise.all(users.map(async (user) => ({ owner: user.id,
        tasks: (await rows(user, "tasks", "select=id")).length, plans: (await rows(user, "daily_plans", "select=id")).length,
        items: (await rows(user, "daily_plan_items", "select=id")).length,
        planningItems: (await rows(user, "planning_items", "select=id")).length,
        finalDailyStatus: (await query(user, today)).dailyStatus })));
      pass("fresh_get_today_matches_persisted_counters_flags_and_times_without_reward_events");
    }

    try {
      await json(apiBase, "/api/health");
      step = "independent test user provisioning";
      const a = await createUser("a");
      const b = await createUser("b");
      const candidate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const initial = await query(a, candidate);
      today = initial.execution.currentDate;
      expect(initial.timezone, "configured user timezone").toBe("Asia/Shanghai");
      expect((await rows(a, "tasks", "select=id")).length, "fresh test user has no existing Tasks").toBe(0);
      pass("independent_accounts_and_user_timezone");

      if (qualificationMode) {
        await smokeQualification(a, b);
      } else {
      step = "fixture creation and Draft guard";
      const taskId = await createTask(a, "Initial", true);
      const past = shiftDate(today, -1), future = shiftDate(today, 1);
      for (const date of [past, future]) { await draft(a, date, taskId); await commit(a, date); }
      await draft(a, today, taskId);
      const draftBefore = await state(a, taskId, today);
      await reject(a, taskId, today, 409, "DAILY_PLAN_NOT_COMMITTED");
      expect(canonical(await state(a, taskId, today)), "Draft rejection writes nothing").toBe(canonical(draftBefore));
      pass("draft_complete_and_uncomplete_rejected");
      await commit(a, today);
      const foreignTaskId = await createTask(b, "Ownership control");
      await draft(b, today, foreignTaskId); await commit(b, today);

      const [pastBefore, futureBefore, currentBefore, otherUserBefore] = await Promise.all([
        state(a, taskId, past), state(a, taskId, future), state(a, taskId, today), state(b, foreignTaskId, today),
      ]);
      const planBefore = canonical(planSnapshot(currentBefore.plan));
      const snapshotBefore = canonical(snapshot(currentBefore.item));
      const planningBefore = canonical(await rows(a, "planning_items", "select=*&order=id"));
      pass("today_committed_with_real_initial_snapshot");

      step = "Complete and refresh persistence";
      const first = await post<TaskExecutionResponse>(a, "task/complete", { taskId, date: today });
      expect(first.data.changed, "first Complete transitions").toBe(true);
      expect(first.effects.join(","), "only Task effect").toBe("task_completed");
      const completed = await state(a, taskId, today); assertExecution(completed, true);
      expect(completed.task.completed_at === completed.item.completed_at_on_day, "both writes use the same execution time").toBe(true);
      expect((await query(a, today)).items.mustDo[0].resultStatus, "fresh Today query preserves Complete").toBe("completed");
      expect((await query(a, today)).dailyStatus).toMatchObject({
        available: true, totalItems: 1, completedItems: 1, completionRate: 100, isQualified: true,
      });
      assertExecution(await state(a, taskId, today), true);
      pass("complete_global_and_daily_persist_after_refresh");

      step = "concurrent Complete retries";
      const repeated = await Promise.all([0, 1].map(() => post<TaskExecutionResponse>(a, "task/complete", { taskId, date: today })));
      expect(repeated.every((result) => !result.data.changed && result.effects.length === 0), "Complete retries emit no transition").toBe(true);
      expect(canonical(await state(a, taskId, today)), "Complete retry preserves all fields including updated_at").toBe(canonical(completed));
      pass("concurrent_complete_retries_preserve_timestamps");

      step = "Uncomplete and refresh persistence";
      const undone = await post<TaskExecutionResponse>(a, "task/uncomplete", { taskId, date: today });
      expect(undone.data.changed && undone.effects.join(",") === "task_uncompleted", "Uncomplete transitions once").toBe(true);
      const uncompleted = await state(a, taskId, today); assertExecution(uncompleted, false);
      expect((await query(a, today)).items.mustDo[0].resultStatus, "fresh Today query preserves Uncomplete").toBe("pending");
      expect((await query(a, today)).dailyStatus).toMatchObject({
        available: true, totalItems: 1, completedItems: 0, completionRate: 0, isQualified: false, qualifiedAt: null,
      });
      assertExecution(await state(a, taskId, today), false);
      pass("uncomplete_global_and_daily_persist_after_refresh");
      step = "concurrent Uncomplete retries";
      const uncompleteRetries = await Promise.all([0, 1].map(() => post<TaskExecutionResponse>(a, "task/uncomplete", { taskId, date: today })));
      expect(uncompleteRetries.every((result) => !result.data.changed && result.effects.length === 0), "Uncomplete retries emit no transition").toBe(true);
      expect(canonical(await state(a, taskId, today)), "Uncomplete retry preserves all timestamps").toBe(canonical(uncompleted));
      pass("concurrent_uncomplete_retries_preserve_timestamps");

      step = "simultaneous first Complete and Uncomplete";
      for (const action of ["complete", "uncomplete"] as const) {
        const concurrent = await Promise.all([0, 1].map(() => post<TaskExecutionResponse>(a, `task/${action}`, { taskId, date: today })));
        expect(concurrent.filter((result) => result.data.changed).length, "exactly one concurrent request changes state").toBe(1);
        expect(concurrent[0].data.task.completedAt === concurrent[1].data.task.completedAt && concurrent[0].data.task.updatedAt === concurrent[1].data.task.updatedAt
          && concurrent[0].data.item.completedAtOnDay === concurrent[1].data.item.completedAtOnDay, "concurrent responses share persisted times").toBe(true);
        assertExecution(await state(a, taskId, today), action === "complete");
      }
      pass("concurrent_first_transitions_are_serialized");

      step = "historical and future guards";
      const beforeRejects = await state(a, taskId, today);
      await reject(a, taskId, past, 409, "TASK_DATE_NOT_CURRENT");
      await reject(a, taskId, future, 409, "TASK_DATE_NOT_CURRENT");
      expect(canonical(await state(a, taskId, today))).toBe(canonical(beforeRejects));
      pass("past_and_future_complete_and_uncomplete_rejected");

      step = "ownership isolation";
      await reject(a, foreignTaskId, today, 404, "TASK_NOT_FOUND");
      await reject(b, taskId, today, 404, "TASK_NOT_FOUND");
      expect((await rows(b, "tasks", `id=eq.${taskId}&select=id`)).length, "other user's Task is unreadable").toBe(0);
      expect(canonical(await state(b, foreignTaskId, today))).toBe(canonical(otherUserBefore));
      expect(canonical(await state(a, taskId, today))).toBe(canonical(beforeRejects));
      pass("basic_ownership_isolation");

      step = "Added Later execution";
      const laterTaskId = await createTask(a, "Added Later");
      await Promise.all([
        post<AddLaterResponse>(a, "today/add-later", { date: today, taskId: laterTaskId, priority: "plan" }),
        post<TaskExecutionResponse>(a, "task/complete", { date: today, taskId }),
      ]);
      expect((await query(a, today)).dailyStatus).toMatchObject({
        available: true, totalItems: 2, completedItems: 1, completionRate: 50, isQualified: false,
      });
      await post<TaskExecutionResponse>(a, "task/complete", { date: today, taskId: laterTaskId });
      assertExecution(await state(a, laterTaskId, today), true);
      expect((await query(a, today)).items.addedLater[0].resultStatus).toBe("completed");
      expect((await query(a, today)).dailyStatus).toMatchObject({ isQualified: true, completionRate: 100 });
      await post<TaskExecutionResponse>(a, "task/uncomplete", { date: today, taskId: laterTaskId });
      assertExecution(await state(a, laterTaskId, today), false);
      await post<TaskExecutionResponse>(a, "task/uncomplete", { date: today, taskId });
      pass("added_later_complete_and_uncomplete");

      step = "concurrent qualification updates for different Tasks";
      for (const action of ["complete", "uncomplete"] as const) {
        await Promise.all([taskId, laterTaskId].map((id) =>
          post<TaskExecutionResponse>(a, `task/${action}`, { date: today, taskId: id })));
        expect((await query(a, today)).dailyStatus).toMatchObject({ available: true,
          totalItems: 2, completedItems: action === "complete" ? 2 : 0,
          completionRate: action === "complete" ? 100 : 0, isQualified: action === "complete",
        });
      }
      pass("qualification_consistent_with_concurrent_execution_and_additions");

      step = "snapshot and other-date preservation";
      const [pastAfter, futureAfter, finalState] = await Promise.all([
        state(a, taskId, past), state(a, taskId, future), state(a, taskId, today),
      ]);
      expect(canonical(pastAfter.item)).toBe(canonical(pastBefore.item));
      expect(canonical(futureAfter.item)).toBe(canonical(futureBefore.item));
      expect(canonical(pastAfter.plan)).toBe(canonical(pastBefore.plan));
      expect(canonical(futureAfter.plan)).toBe(canonical(futureBefore.plan));
      expect(canonical(snapshot(finalState.item))).toBe(snapshotBefore);
      expect(canonical(planSnapshot(finalState.plan)), "snapshot metadata untouched").toBe(planBefore);
      expect(canonical(await rows(a, "planning_items", "select=*&order=id")), "schedule untouched").toBe(planningBefore);
      const refreshed = await query(a, today);
      expect(refreshed.items.mustDo[0].title).toBe(currentBefore.item.title_snapshot);
      expect(refreshed.items.mustDo[0].plannedStartTime).toBe("09:00:00");
      expect(refreshed.dailyStatus).toMatchObject({ available: true, totalItems: 2, completedItems: 0, isQualified: false });
      pass("other_dates_and_initial_title_time_snapshot_unchanged");
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error("Smoke failed.");
    } finally {
      // Revocation/ban only: deleting the auth owner would cascade into immutable history.
      for (const user of users) {
        const result = { userId: user.id, sessionRevoked: false, accountDisabled: false };
        if (user.token) {
          try { result.sessionRevoked = (await send(supabaseBase, "/auth/v1/logout?scope=global", { method: "POST", headers: userHeaders(user) }, true)).ok; } catch { /* report cleanup state */ }
        }
        try {
          result.accountDisabled = (await send(supabaseBase, `/auth/v1/admin/users/${user.id}`, {
            method: "PUT", headers: adminHeaders, body: JSON.stringify({ ban_duration: "8760h" }),
          }, true)).ok;
        } catch { /* report cleanup state */ }
        cleanup.push(result);
      }
      if (!failure && cleanup.some((entry) => !entry.sessionRevoked || !entry.accountDisabled)) {
        failure = new Error("Test-account session revocation or disablement incomplete.");
      }
      const report = {
        runId, result: failure ? "FAIL" : "PASS", lastStep: step, today, timezone: "Asia/Shanghai",
        passed, failure: failure?.message ?? null,
        accounts: users.map(({ id, email }) => ({ id, email })), tasks, plans, cleanup,
        immutableFixturesDeleted: false, pgTapExecuted: false, qualificationEvidence,
        uncovered: ["pgTAP failure-injection rollback", "full RLS suite (intentionally excluded)", "Desktop browser UI not rerun"],
      };
      writeFileSync(qualificationMode ? ".env.m2-daily-qualification-smoke-result.json" : ".env.m2-task-execution-smoke-result.json", JSON.stringify(report, null, 2));
      console.info(JSON.stringify(qualificationMode ? { ...report, tasks: { retained: tasks.length } } : report));
    }
    if (failure) throw failure;
    expect(cleanup.every((entry) => entry.sessionRevoked && entry.accountDisabled), "test sessions revoked and accounts disabled").toBe(true);
  }, 600_000);
});

interface SmokeUser { id: string; email: string; token: string }
type Row = Record<string, unknown>;
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing smoke configuration: ${name}`);
  return value;
}
function shiftDate(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function planSnapshot(plan: Row): Row {
  return Object.fromEntries(Object.entries(plan).filter(([name]) => ![
    "total_item_count", "completed_item_count", "must_do_item_count", "completed_must_do_item_count",
    "completion_rate", "is_qualified", "qualified_at", "qualification_calculated_at", "updated_at",
  ].includes(name)));
}
function snapshot(item: Row): Row {
  return Object.fromEntries(Object.entries(item).filter(([name]) => !["result_status", "completed_at_on_day", "updated_at"].includes(name)));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { AddLaterResponse, CommitDailyPlanResponse, CreateTaskResponse, TaskExecutionResponse, TodayResponse, UpsertDraftTodayItemResponse } from "@reward-planner/types";
import { describe, expect, it } from "vitest";

// Explicit opt-in only. Reuses the existing live-smoke HTTP pattern, but creates
// independent users and NEVER deletes Tasks, Plans, Items or auth owners.
describe.skipIf(!process.env.TASK_EXECUTION_SMOKE_API_BASE_URL)("RP-M2-01 real database smoke", () => {
  it("persists execution with idempotency, date guards, history and ownership", async () => {
    const apiBase = required("TASK_EXECUTION_SMOKE_API_BASE_URL");
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
          headers: { "Content-Type": "application/json", "User-Agent": "RewardPlanner-M2-01-Smoke/1.0", ...init.headers },
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
      const email = `rp-m2-01-${runId}-${label}@example.test`;
      const password = `${randomBytes(28).toString("base64url")}aA1!`;
      const created = await json<{ id: string }>(supabaseBase, "/auth/v1/admin/users", {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { purpose: "RP-M2-01 smoke", run_id: runId } }),
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
        title: `RP-M2-01 ${runId.slice(0, 8)} ${kind}`,
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
      const planBefore = canonical(currentBefore.plan);
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
      await post<AddLaterResponse>(a, "today/add-later", { date: today, taskId: laterTaskId, priority: "plan" });
      await post<TaskExecutionResponse>(a, "task/complete", { date: today, taskId: laterTaskId });
      assertExecution(await state(a, laterTaskId, today), true);
      expect((await query(a, today)).items.addedLater[0].resultStatus).toBe("completed");
      await post<TaskExecutionResponse>(a, "task/uncomplete", { date: today, taskId: laterTaskId });
      assertExecution(await state(a, laterTaskId, today), false);
      pass("added_later_complete_and_uncomplete");

      step = "snapshot and other-date preservation";
      const [pastAfter, futureAfter, finalState] = await Promise.all([
        state(a, taskId, past), state(a, taskId, future), state(a, taskId, today),
      ]);
      expect(canonical(pastAfter.item)).toBe(canonical(pastBefore.item));
      expect(canonical(futureAfter.item)).toBe(canonical(futureBefore.item));
      expect(canonical(pastAfter.plan)).toBe(canonical(pastBefore.plan));
      expect(canonical(futureAfter.plan)).toBe(canonical(futureBefore.plan));
      expect(canonical(snapshot(finalState.item))).toBe(snapshotBefore);
      expect(canonical(finalState.plan), "snapshot metadata and qualification untouched").toBe(planBefore);
      expect(canonical(await rows(a, "planning_items", "select=*&order=id")), "schedule untouched").toBe(planningBefore);
      const refreshed = await query(a, today);
      expect(refreshed.items.mustDo[0].title).toBe(currentBefore.item.title_snapshot);
      expect(refreshed.items.mustDo[0].plannedStartTime).toBe("09:00:00");
      expect(refreshed.dailyStatus.available).toBe(false);
      pass("other_dates_and_initial_title_time_snapshot_unchanged");
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
        immutableFixturesDeleted: false, pgTapExecuted: false,
        uncovered: ["pgTAP failure-injection rollback", "full RLS suite (intentionally excluded)", "Desktop browser UI not rerun"],
      };
      writeFileSync(".env.m2-task-execution-smoke-result.json", JSON.stringify(report, null, 2));
      console.info(JSON.stringify(report));
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
function snapshot(item: Row): Row {
  return Object.fromEntries(Object.entries(item).filter(([name]) => !["result_status", "completed_at_on_day", "updated_at"].includes(name)));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

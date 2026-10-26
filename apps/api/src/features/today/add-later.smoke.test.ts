import { describe, expect, it } from "vitest";

// Opt-in against the verified development project; ordinary pnpm test is offline.
describe.skipIf(!process.env.ADDED_LATER_SMOKE_API_BASE_URL)("Added Later live smoke", () => {
  it("adds once under concurrent calls and preserves both Initial and Added Later snapshots", async () => {
    const apiBase = required("ADDED_LATER_SMOKE_API_BASE_URL");
    const supabaseBase = required("SUPABASE_URL");
    const anonKey = required("SUPABASE_ANON_KEY");
    const secretKey = required("SUPABASE_SECRET_KEY");
    const date = new Date(Date.UTC(2090, 0, 1 + Math.floor(Math.random() * 3000))).toISOString().slice(0, 10);
    let token: string | undefined;
    let owner: string | undefined;
    let planId: string | undefined;
    const taskIds: string[] = [];
    let createAttempts = 0;
    let draftAttempted = false;
    let smokeFailure: unknown;
    const cleanupFailures: string[] = [];
    const adminHeaders = {
      apikey: secretKey, Authorization: `Bearer ${secretKey}`,
      "User-Agent": "RewardPlannerSmoke/1.0",
    };

    try {
      const auth = await requestJson(supabaseBase, "/auth/v1/token?grant_type=password", {
        method: "POST", headers: { apikey: anonKey },
        body: JSON.stringify({ email: required("RLS_TEST_USER_A_EMAIL"), password: required("RLS_TEST_USER_A_PASSWORD") }),
      });
      token = auth.access_token as string;
      owner = (auth.user as { id: string }).id;
      expect(Boolean(token && owner), "test session").toBe(true);
      const headers = { Authorization: `Bearer ${token}` };
      const before = await requestJson(apiBase, `/api/today?date=${date}`, { headers });
      expect(before.dailyPlan === null, "test date must be unused").toBe(true);

      createAttempts++;
      const initial = await requestJson(apiBase, "/api/commands/task/create", {
        method: "POST", headers, body: JSON.stringify({ title: "M1-08 Initial temporary Task", schedule: null }),
      });
      const initialId = ((initial.data as Record<string, unknown>).task as { id: string }).id;
      taskIds.push(initialId);
      draftAttempted = true;
      const draft = await requestJson(apiBase, "/api/commands/today/draft/upsert-item", {
        method: "POST", headers, body: JSON.stringify({ date, taskId: initialId, priority: "must_do" }),
      });
      planId = (draft.data as { dailyPlanId: string }).dailyPlanId;
      await requestJson(apiBase, "/api/commands/today/commit", {
        method: "POST", headers, body: JSON.stringify({ date }),
      });
      const committed = await requestJson(apiBase, `/api/today?date=${date}`, { headers });
      expect((committed.dailyPlan as Record<string, unknown>).status === "committed", "committed Plan").toBe(true);

      createAttempts++;
      const createdLater = await requestJson(apiBase, "/api/commands/task/create", {
        method: "POST", headers,
        body: JSON.stringify({ title: "M1-08 Added Later temporary Task", schedule: { plannedDate: date, startTime: "11:00", endTime: "12:00" } }),
      });
      const laterId = ((createdLater.data as Record<string, unknown>).task as { id: string }).id;
      taskIds.push(laterId);
      await requestJson(apiBase, "/api/commands/task/edit", {
        method: "POST", headers, body: JSON.stringify({ taskId: laterId, title: "M1-08 current title at addition" }),
      });

      const additions = await Promise.all([0, 1].map(() => requestJson(apiBase, "/api/commands/today/add-later", {
        method: "POST", headers, body: JSON.stringify({ date, taskId: laterId, priority: "must_do" }),
      })));
      expect(JSON.stringify(additions[0]) === JSON.stringify(additions[1]), "concurrent callers get the same frozen item").toBe(true);
      const today = await requestJson(apiBase, `/api/today?date=${date}`, { headers });
      const oldItems = committed.items as Record<string, unknown>;
      const newItems = today.items as { mustDo: unknown[]; plan: unknown[]; addedLater: Record<string, unknown>[] };
      expect(JSON.stringify(today.dailyPlan) === JSON.stringify(committed.dailyPlan), "Plan status and snapshot timestamp unchanged").toBe(true);
      expect(JSON.stringify(newItems.mustDo) === JSON.stringify(oldItems.mustDo) && JSON.stringify(newItems.plan) === JSON.stringify(oldItems.plan), "Initial Snapshot unchanged").toBe(true);
      expect(newItems.addedLater.length === 1, "exactly one Added Later item").toBe(true);
      const item = newItems.addedLater[0];
      expect(item.taskId === laterId && item.origin === "added_later" && item.priority === "must_do" && item.resultStatus === "pending", "Added Later identity and state").toBe(true);
      expect(item.title === "M1-08 current title at addition" && item.plannedStartTime === "11:00:00" && item.plannedEndTime === "12:00:00", "current title and same-day time frozen").toBe(true);
      expect(today.dailyStatus).toMatchObject({ available: true, totalItems: 2, completedItems: 0, isQualified: false });

      await requestJson(apiBase, "/api/commands/task/edit", {
        method: "POST", headers, body: JSON.stringify({ taskId: laterId, title: "M1-08 changed after snapshot" }),
      });
      const retry = await requestJson(apiBase, "/api/commands/today/add-later", {
        method: "POST", headers, body: JSON.stringify({ date, taskId: laterId, priority: "plan" }),
      });
      expect(JSON.stringify(retry) === JSON.stringify(additions[0]), "retry preserves original priority and snapshot").toBe(true);
      const after = await requestJson(apiBase, `/api/today?date=${date}`, { headers });
      expect(JSON.stringify(after.items) === JSON.stringify(today.items), "global title does not rewrite snapshots").toBe(true);
      const initialConflict = await safeFetch(new URL("/api/commands/today/add-later", apiBase), {
        method: "POST", headers, body: JSON.stringify({ date, taskId: initialId, priority: "plan" }),
      });
      expect(initialConflict.status, "Initial item cannot change origin").toBe(409);
    } catch (error) {
      smokeFailure = error;
    } finally {
      if (draftAttempted && !planId && owner) {
        try {
          const rows = await requestRows(supabaseBase, `/rest/v1/daily_plans?user_id=eq.${owner}&plan_date=eq.${date}&select=id`, adminHeaders);
          if (rows.length === 1) { planId = rows[0].id as string; }
          else if (rows.length > 1) { cleanupFailures.push("unexpected test Draft records"); }
        } catch { cleanupFailures.push("test Draft creation state unconfirmed"); }
      }
      const fixtures: [string, string | undefined][] = [
        ["daily_plans", planId], ...taskIds.map((id): [string, string] => ["tasks", id]),
      ];
      for (const [table, id] of fixtures) {
        if (!id || !owner) { continue; }
        try {
          const path = `/rest/v1/${table}?id=eq.${id}&user_id=eq.${owner}`;
          await requestJson(supabaseBase, path, { method: "DELETE", headers: adminHeaders });
          const rows = await requestRows(supabaseBase, `${path}&select=id`, adminHeaders);
          if (rows.length !== 0) { cleanupFailures.push(`test ${table} still exists`); }
        } catch { cleanupFailures.push(`test ${table} cleanup failed`); }
      }
      if (createAttempts !== taskIds.length) { cleanupFailures.push("test Task creation state unconfirmed"); }
      if (token) {
        try { await requestJson(supabaseBase, "/auth/v1/logout?scope=local", {
          method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        }); } catch { /* No persistent test session is stored. */ }
      }
    }
    if (cleanupFailures.length) { throw new Error(`Fixture cleanup failed: ${cleanupFailures.join("; ")}`); }
    if (smokeFailure) { throw smokeFailure; }
  }, 120_000);
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) { throw new Error(`Missing smoke environment variable: ${name}`); }
  return value;
}

async function safeFetch(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init, headers: { "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new Error("Smoke network request failed."); }
}

async function requestJson(base: string, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await safeFetch(new URL(path, base), init);
  if (!response.ok) { throw new Error(`Smoke request failed with HTTP ${response.status}.`); }
  const text = await response.text();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

async function requestRows(base: string, path: string, headers: Record<string, string>): Promise<Record<string, unknown>[]> {
  const response = await safeFetch(new URL(path, base), { headers });
  if (!response.ok) { throw new Error(`Fixture lookup failed with HTTP ${response.status}.`); }
  return await response.json() as Record<string, unknown>[];
}

import { describe, expect, it } from "vitest";

// Opt-in live smoke against the linked development project. Normal pnpm test
// remains offline; credentials are provided only to this test process.
describe.skipIf(!process.env.COMMIT_SMOKE_API_BASE_URL)("Commit Daily Plan live smoke", () => {
  it("freezes once under concurrent commits and preserves the snapshot after title edits", async () => {
    const apiBase = required("COMMIT_SMOKE_API_BASE_URL");
    const supabaseBase = required("SUPABASE_URL");
    const anonKey = required("SUPABASE_ANON_KEY");
    const secretKey = required("SUPABASE_SECRET_KEY");
    const date = new Date(Date.UTC(2090, 0, 1 + Math.floor(Math.random() * 3000)))
      .toISOString().slice(0, 10);
    const initialTitle = "M1-07 smoke temporary task";
    const frozenTitle = "M1-07 title current at Commit";
    let token: string | undefined;
    let owner: string | undefined;
    let taskId: string | undefined;
    let planId: string | undefined;
    let createAttempted = false;
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
        body: JSON.stringify({
          email: required("RLS_TEST_USER_A_EMAIL"),
          password: required("RLS_TEST_USER_A_PASSWORD"),
        }),
      });
      token = auth.access_token as string;
      owner = (auth.user as { id: string }).id;
      expect(Boolean(token && owner), "test authentication").toBe(true);
      const headers = { Authorization: `Bearer ${token}` };
      const before = await requestJson(apiBase, `/api/today?date=${date}`, { headers });
      expect(before.dailyPlan === null, "test date must be unused").toBe(true);

      createAttempted = true;
      const created = await requestJson(apiBase, "/api/commands/task/create", {
        method: "POST", headers,
        body: JSON.stringify({ title: initialTitle, schedule: { plannedDate: date, startTime: "09:00", endTime: "10:00" } }),
      });
      taskId = ((created.data as Record<string, unknown>).task as { id: string }).id;
      draftAttempted = true;
      const drafted = await requestJson(apiBase, "/api/commands/today/draft/upsert-item", {
        method: "POST", headers, body: JSON.stringify({ date, taskId, priority: "must_do" }),
      });
      planId = (drafted.data as { dailyPlanId: string }).dailyPlanId;
      const itemId = ((drafted.data as Record<string, unknown>).item as { id: string }).id;
      await requestJson(apiBase, "/api/commands/task/edit", {
        method: "POST", headers, body: JSON.stringify({ taskId, title: frozenTitle }),
      });

      // Two independent HTTP requests exercise PostgreSQL plan-row locking.
      const commits = await Promise.all([0, 1].map(() => requestJson(apiBase, "/api/commands/today/commit", {
        method: "POST", headers, body: JSON.stringify({ date }),
      })));
      expect(JSON.stringify(commits[0]) === JSON.stringify(commits[1]), "concurrent commit results must match").toBe(true);
      const plan = (commits[0].data as Record<string, unknown>).dailyPlan as Record<string, unknown>;
      expect(plan.id === planId && plan.status === "committed" && typeof plan.snapshotCreatedAt === "string", "confirmed committed state").toBe(true);
      const today = await requestJson(apiBase, `/api/today?date=${date}`, { headers });
      const items = (today.items as { mustDo: Record<string, unknown>[]; plan: unknown[]; addedLater: unknown[] });
      expect(items.mustDo.length === 1 && items.plan.length === 0 && items.addedLater.length === 0, "no duplicate item").toBe(true);
      const item = items.mustDo[0];
      expect(item.id === itemId && item.taskId === taskId && item.origin === "initial" && item.priority === "must_do", "item identity and priority").toBe(true);
      expect(item.title === frozenTitle && item.plannedStartTime === "09:00:00" && item.plannedEndTime === "10:00:00", "fresh title and same-day time snapshots").toBe(true);

      await requestJson(apiBase, "/api/commands/task/edit", {
        method: "POST", headers, body: JSON.stringify({ taskId, title: "M1-07 changed after Commit" }),
      });
      const repeated = await requestJson(apiBase, "/api/commands/today/commit", {
        method: "POST", headers, body: JSON.stringify({ date }),
      });
      expect(JSON.stringify(repeated) === JSON.stringify(commits[0]), "retry must preserve snapshot timestamp").toBe(true);
      const after = await requestJson(apiBase, `/api/today?date=${date}`, { headers });
      expect(JSON.stringify(after.items) === JSON.stringify(today.items), "global title change cannot rewrite committed items").toBe(true);
      for (const operation of ["upsert-item", "remove-item"]) {
        const response = await safeFetch(new URL(`/api/commands/today/draft/${operation}`, apiBase), {
          method: "POST", headers,
          body: JSON.stringify(operation === "upsert-item" ? { date, taskId, priority: "plan" } : { date, taskId }),
        });
        expect(response.status, "committed Draft edits must conflict").toBe(409);
      }
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
      for (const [table, id] of [["daily_plans", planId], ["tasks", taskId]]) {
        if (!id || !owner) { continue; }
        try {
          const path = `/rest/v1/${table}?id=eq.${id}&user_id=eq.${owner}`;
          await requestJson(supabaseBase, path, { method: "DELETE", headers: adminHeaders });
          const rows = await requestRows(supabaseBase, `${path}&select=id`, adminHeaders);
          if (rows.length !== 0) { cleanupFailures.push(`test ${table} still exists`); }
        } catch { cleanupFailures.push(`test ${table} cleanup failed`); }
      }
      if (createAttempted && !taskId) { cleanupFailures.push("test Task creation state unconfirmed"); }
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

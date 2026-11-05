import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const cleanupTables = ["profiles", "user_settings", "tasks", "planning_items", "daily_plans", "daily_plan_items", "reward_events", "wishes", "reward_allocations"] as const;
export type RunOwner = { id: string; email: string };
export type RunManifest = {
  runId: string; owners: RunOwner[]; attemptedEmails: string[]; attemptedPaths: string[];
  smokePid?: number; smokeFinished?: boolean; uncertainRequests?: boolean;
};
export type AdminRequest = (path: string, init?: RequestInit) => Promise<Response>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const purpose = "RP-M3-03 Smoke";
function requireCondition(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export function validateManifest(m: RunManifest) {
  requireCondition(uuid.test(m.runId), "Invalid run tag");
  const allowed = ["a", "b"].map(label => `rp-m3-03-${m.runId}-${label}@example.test`);
  requireCondition(Array.isArray(m.attemptedEmails) && m.attemptedEmails.length <= 2 && new Set(m.attemptedEmails).size === m.attemptedEmails.length && m.attemptedEmails.every(e => allowed.includes(e)), "Invalid run emails");
  requireCondition(Array.isArray(m.owners) && m.owners.length <= 2 && new Set(m.owners.map(o => o.id)).size === m.owners.length && new Set(m.owners.map(o => o.email)).size === m.owners.length, "Invalid run owners");
  requireCondition(m.owners.every(o => uuid.test(o.id) && m.attemptedEmails.includes(o.email)), "Foreign owner in manifest");
  requireCondition(Array.isArray(m.attemptedPaths) && m.attemptedPaths.every(p => m.owners.some(o => p.startsWith(`${o.id}/`)) && /^[0-9a-f-]{36}\/(?:[0-9a-f-]{36}|arbitrary)\.jpg$/.test(p)), "Foreign or invalid object path");
}
function ownedUser(m: RunManifest, u: { id?: unknown; email?: unknown; user_metadata?: Record<string, unknown> }): RunOwner {
  requireCondition(typeof u.id === "string" && uuid.test(u.id) && typeof u.email === "string" && m.attemptedEmails.includes(u.email) && u.user_metadata?.run_id === m.runId && u.user_metadata?.purpose === purpose, "Auth owner/run-tag mismatch");
  return { id: u.id, email: u.email };
}
async function jsonResponse(r: Response): Promise<unknown> {
  requireCondition(r.ok, `Admin read failed: HTTP ${r.status}`);
  return r.json();
}
export async function snapshotRewards(m: RunManifest, request: AdminRequest) {
  validateManifest(m);
  requireCondition(m.owners.length === 2, "Reward snapshot requires both fresh run owners");
  return Promise.all(m.owners.map(async o => ({ userId: o.id, ...Object.fromEntries(await Promise.all(
    ["reward_events", "reward_allocations"].map(async table => {
      const rows = await jsonResponse(await request(`/rest/v1/${table}?select=*&user_id=eq.${o.id}&order=id`));
      requireCondition(Array.isArray(rows) && rows.every(row => row && row.user_id === o.id), "Malformed or foreign reward snapshot");
      return [table, rows];
    })
  )) })));
}
// Auth Admin's paginated list is required for an unknown create outcome. Only
// exact attempted emails + purpose + run_id are retained; never mutate other users.
export async function discoverRunOwners(m: RunManifest, request: AdminRequest): Promise<RunOwner[]> {
  validateManifest(m);
  const found: RunOwner[] = [];
  for (let page = 1; page <= 100; page++) {
    const body = await jsonResponse(await request(`/auth/v1/admin/users?page=${page}&per_page=100`)) as { users?: { id?: unknown; email?: unknown; user_metadata?: Record<string, unknown> }[] };
    requireCondition(Array.isArray(body.users), "Malformed Auth user listing");
    for (const u of body.users) {
      if (typeof u.email === "string" && m.attemptedEmails.includes(u.email)) found.push(ownedUser(m, u));
    }
    // Continue until an empty page: do not assume the server honored per_page.
    if (body.users.length === 0) {
      requireCondition(new Set(found.map(o => o.email)).size === found.length && found.length <= 2, "Duplicate run accounts");
      return found;
    }
  }
  throw Error("Run-tag lookup incomplete; cleanup not confirmed");
}
async function verifyOwnerAbsent(o: RunOwner, request: AdminRequest) {
  const auth = await request(`/auth/v1/admin/users/${o.id}`);
  requireCondition(auth.status === 404, "Auth user still present or unavailable");
  const objects = await jsonResponse(await request("/storage/v1/object/list/wish-covers", { method: "POST", body: JSON.stringify({ prefix: `${o.id}/`, limit: 1 }) }));
  requireCondition(Array.isArray(objects) && objects.length === 0, "Storage prefix not empty");
  for (const table of cleanupTables) {
    const key = table === "profiles" ? "id" : "user_id";
    const rows = await jsonResponse(await request(`/rest/v1/${table}?select=${key}&${key}=eq.${o.id}&limit=1`));
    requireCondition(Array.isArray(rows) && rows.length === 0, `Residual data in ${table}`);
  }
}
export async function cleanupRun(m: RunManifest, request: AdminRequest) {
  validateManifest(m);
  let discoveryComplete = false;
  let discovered: RunOwner[] = [];
  try { discovered = await discoverRunOwners(m, request); discoveryComplete = true; } catch { /* Known users still need cleanup. */ }
  const all = new Map(m.owners.map(o => [o.id, o]));
  for (const o of discovered) all.set(o.id, o);
  const owners = [...all.values()];
  const identityValid = owners.length <= 2 && new Set(owners.map(o => o.email)).size === owners.length;
  const entries: { userId: string; pass: boolean }[] = [];
  for (const o of owners) {
    try {
      requireCondition(identityValid, "Conflicting run identities");
      const user = await request(`/auth/v1/admin/users/${o.id}`);
      if (user.status !== 404) {
        const actual = ownedUser(m, await jsonResponse(user) as Parameters<typeof ownedUser>[1]);
        requireCondition(actual.id === o.id && actual.email === o.email, "Run identity mismatch");
        const paths = m.attemptedPaths.filter(p => p.startsWith(`${o.id}/`));
        if (paths.length) {
          const removed = await request("/storage/v1/object/wish-covers", { method: "DELETE", body: JSON.stringify({ prefixes: paths }) });
          requireCondition(removed.ok, "Storage removal unconfirmed");
        }
        const objects = await jsonResponse(await request("/storage/v1/object/list/wish-covers", { method: "POST", body: JSON.stringify({ prefix: `${o.id}/`, limit: 1 }) }));
        requireCondition(Array.isArray(objects) && objects.length === 0, "Objects remain; preserve Auth owner for reconciliation");
        const removed = await request(`/auth/v1/admin/users/${o.id}`, { method: "DELETE" });
        requireCondition(removed.ok, "Account removal unconfirmed");
      }
      await verifyOwnerAbsent(o, request);
      entries.push({ userId: o.id, pass: true });
    } catch { entries.push({ userId: o.id, pass: false }); }
  }
  return { owners, entries, discoveryComplete, pass: discoveryComplete && identityValid && !m.uncertainRequests && entries.every(e => e.pass) };
}
export async function verifyCleanup(m: RunManifest, request: AdminRequest) {
  validateManifest(m);
  requireCondition(m.smokeFinished === true, "Smoke did not record completion; reconciliation required");
  requireCondition((await discoverRunOwners(m, request)).length === 0, "Run-tag account still exists");
  for (const o of m.owners) await verifyOwnerAbsent(o, request);
  requireCondition(!m.uncertainRequests, "Unknown request outcome; zero-at-this-instant is not settled cleanup proof");
  return { pass: true, runId: m.runId, ownersChecked: m.owners.length, tablesPerOwner: cleanupTables.length };
}

// Separate, read-only CLI. Never runs when imported by Vitest.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = JSON.parse(readFileSync(process.argv[2], "utf8")) as RunManifest;
    requireCondition(Number.isInteger(manifest.smokePid) && manifest.smokePid! > 0, "Missing Smoke process identity");
    let alive = true;
    try { process.kill(manifest.smokePid!, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
    requireCondition(!alive, "Smoke process is still running; independent check refused");
    const linked = JSON.parse(readFileSync("supabase/.temp/linked-project.json", "utf8"));
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    requireCondition(linked.name === "reward-planner-dev" && linked.ref === "tvyvgcnllzhlowewajnp" && url === `https://${linked.ref}.supabase.co` && key, "Dev configuration mismatch");
    const request: AdminRequest = (p, init = {}) => {
      requireCondition(!init.method || ["GET", "POST"].includes(init.method), "Independent verifier is read-only");
      requireCondition(init.method !== "POST" || p === "/storage/v1/object/list/wish-covers", "Only Storage listing may POST");
      return fetch(new URL(p, url), { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000), cache: "no-store" });
    };
    console.log(JSON.stringify(await verifyCleanup(manifest, request)));
  } catch {
    console.error("Independent cleanup NOT CONFIRMED; inspect scoped evidence, no deletion performed.");
    process.exitCode = 1;
  }
}

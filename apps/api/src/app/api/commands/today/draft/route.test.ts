import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { DraftTodayCommandError, type DraftTodayErrorCode } from "../../../../../features/today/draft-today";
import { upsertDraftTodayItemPostHandler, removeDraftTodayItemPostHandler } from "./handler";

const identity = { date: "2026-10-03", taskId: "10000000-0000-4000-8000-000000000001" };
const context = { supabase: {} } as AuthenticatedRequestContext;

describe.each(["upsert", "remove"] as const)("Draft Today %s route", (operation) => {
  const input = operation === "upsert" ? { ...identity, priority: "must_do" } : identity;
  const body = operation === "upsert"
    ? { data: { dailyPlanId: "plan", item: { id: "item", taskId: identity.taskId, origin: "initial" as const, priority: "must_do" as const, resultStatus: "pending" as const } }, effects: ["draft_item_upserted" as const] }
    : { data: { dailyPlanId: "plan", taskId: identity.taskId }, effects: ["draft_item_removed" as const] };

  function handler(authenticate = vi.fn(async (): Promise<AuthenticatedRequestContext | null> => context), command = vi.fn(async () => body)) {
    return operation === "upsert"
      ? upsertDraftTodayItemPostHandler({ authenticate, command: command as never })
      : removeDraftTodayItemPostHandler({ authenticate, command: command as never });
  }

  it("returns 200 and only passes the validated request", async () => {
    const authenticate = vi.fn(async () => context);
    const command = vi.fn(async () => body);
    const response = await handler(authenticate, command)(request(input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(body);
    expect(command).toHaveBeenCalledWith(context, input);
  });

  it("returns 401 for missing and invalid auth", async () => {
    const authenticate = vi.fn(async () => null);
    const command = vi.fn(async () => body);
    expect((await handler(authenticate, command)(request(input, ""))).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    expect((await handler(authenticate, command)(request(input))).status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, date: "2026-02-29" }, { ...input, taskId: "invalid" },
    { ...input, userId: identity.taskId }, { ...input, schedule: null },
  ])("returns 400 for invalid or injected requests %#", async (invalid) => {
    expect((await handler()(request(invalid))).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const response = await handler()(new Request("http://localhost/", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
  });

  it.each([
    ["TASK_NOT_FOUND", 404], ["DRAFT_ITEM_NOT_FOUND", 404],
    ["DAILY_PLAN_ALREADY_COMMITTED", 409], ["TASK_NOT_DRAFT_ELIGIBLE", 409],
    ["DRAFT_ITEM_NOT_INITIAL", 409],
  ] as const)("returns %s domain status %s", async (code: DraftTodayErrorCode, status) => {
    const command = vi.fn(async () => { throw new DraftTodayCommandError(code); });
    const response = await handler(undefined, command)(request(input));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it("does not leak unexpected failures", async () => {
    const command = vi.fn(async () => { throw new Error("private DB detail"); });
    const response = await handler(undefined, command)(request(input));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

function request(body: unknown, authorization = "Bearer test-token") {
  return new Request("http://localhost/", {
    method: "POST", body: JSON.stringify(body), headers: { Authorization: authorization },
  });
}

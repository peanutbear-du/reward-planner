import type { CommitDailyPlanResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { CommitDailyPlanCommandError } from "../../../../../features/today/commit-daily-plan";
import { commitDailyPlanPostHandler } from "./handler";

const context = { supabase: {} } as AuthenticatedRequestContext;
const responseBody: CommitDailyPlanResponse = {
  data: { date: "2026-10-09", dailyPlan: { id: "plan", status: "committed", snapshotCreatedAt: "2026-10-09T01:00:00Z" } },
  effects: ["daily_plan_committed"],
};

describe("POST /api/commands/today/commit", () => {
  it("returns 200 and the confirmed Plan with a private no-store response", async () => {
    const command = vi.fn(async () => responseBody);
    const handler = commitDailyPlanPostHandler({ authenticate: async () => context, command });
    const response = await handler(request({ date: "2026-10-09" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(responseBody);
    expect(command).toHaveBeenCalledWith(context, { date: "2026-10-09" });
  });

  it("returns 401 for missing or invalid authentication", async () => {
    const authenticate = vi.fn(async () => null);
    const command = vi.fn(async () => responseBody);
    const handler = commitDailyPlanPostHandler({ authenticate, command });
    expect((await handler(request({ date: "2026-10-09" }, ""))).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    expect((await handler(request({ date: "2026-10-09" }))).status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    {}, { date: "2026-02-29" }, { date: "2026-10-09", userId: "another-user" },
    { date: "2026-10-09", status: "committed" },
    { date: "2026-10-09", snapshotCreatedAt: "client-time" },
  ])("returns 400 for invalid or injected request %#", async (input) => {
    const authenticate = vi.fn(async () => context);
    const handler = commitDailyPlanPostHandler({ authenticate, command: async () => responseBody });
    expect((await handler(request(input))).status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const handler = commitDailyPlanPostHandler({ authenticate: async () => context, command: async () => responseBody });
    expect((await handler(new Request("http://localhost/", { method: "POST", body: "{" }))).status).toBe(400);
  });

  it.each([
    ["DAILY_PLAN_NOT_FOUND", 404], ["DAILY_PLAN_EMPTY", 409], ["DAILY_PLAN_ITEMS_INVALID", 409],
  ] as const)("returns %s with status %s", async (code, status) => {
    const handler = commitDailyPlanPostHandler({
      authenticate: async () => context,
      command: async () => { throw new CommitDailyPlanCommandError(code); },
    });
    const response = await handler(request({ date: "2026-10-09" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it("returns only a generic error for an unexpected failure", async () => {
    const handler = commitDailyPlanPostHandler({
      authenticate: async () => context,
      command: async () => { throw new Error("private SQL detail"); },
    });
    const response = await handler(request({ date: "2026-10-09" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

function request(body: unknown, authorization = "Bearer test-token") {
  return new Request("http://localhost:3001/api/commands/today/commit", {
    method: "POST", body: JSON.stringify(body), headers: { Authorization: authorization },
  });
}

import type { AddLaterResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { AddLaterCommandError } from "../../../../../features/today/add-later";
import { addLaterPostHandler } from "./handler";

const taskId = "10000000-0000-4000-8000-000000000001";
const input = { date: "2026-10-10", taskId, priority: "plan" as const };
const context = { supabase: {} } as AuthenticatedRequestContext;
const responseBody: AddLaterResponse = {
  data: { dailyPlanId: "plan", item: {
    id: "item", taskId, origin: "added_later", priority: "plan", resultStatus: "pending",
    title: "Frozen title", plannedStartTime: null, plannedEndTime: null,
    completedAtOnDay: null, rescheduledToDate: null,
  } }, effects: ["daily_item_added_later"],
};

describe("POST /api/commands/today/add-later", () => {
  it("returns the server-confirmed item with a private no-store 200", async () => {
    const command = vi.fn(async () => responseBody);
    const handler = addLaterPostHandler({ authenticate: async () => context, command });
    const response = await handler(request(input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(responseBody);
    expect(command).toHaveBeenCalledWith(context, input);
  });

  it("returns 401 for missing or invalid auth", async () => {
    const authenticate = vi.fn(async () => null);
    const command = vi.fn(async () => responseBody);
    const handler = addLaterPostHandler({ authenticate, command });
    expect((await handler(request(input, ""))).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    expect((await handler(request(input))).status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    { date: input.date, taskId }, { ...input, priority: "urgent" },
    { ...input, date: "2026-02-29" }, { ...input, taskId: "invalid" },
    { ...input, userId: taskId }, { ...input, origin: "initial" }, { ...input, schedule: null },
  ])("rejects invalid or injected request %#", async (invalid) => {
    const authenticate = vi.fn(async () => context);
    const handler = addLaterPostHandler({ authenticate, command: async () => responseBody });
    expect((await handler(request(invalid))).status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const handler = addLaterPostHandler({ authenticate: async () => context, command: async () => responseBody });
    expect((await handler(new Request("http://localhost/", { method: "POST", body: "{" }))).status).toBe(400);
  });

  it.each([
    ["DAILY_PLAN_NOT_FOUND", 404], ["DAILY_PLAN_NOT_COMMITTED", 409], ["TASK_NOT_FOUND", 404],
    ["TASK_NOT_ADDED_LATER_ELIGIBLE", 409], ["INITIAL_ITEM_ALREADY_EXISTS", 409],
  ] as const)("maps %s to %s", async (code, status) => {
    const handler = addLaterPostHandler({
      authenticate: async () => context,
      command: async () => { throw new AddLaterCommandError(code); },
    });
    const response = await handler(request(input));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it("does not expose unexpected failures", async () => {
    const handler = addLaterPostHandler({
      authenticate: async () => context,
      command: async () => { throw new Error("private SQL detail"); },
    });
    const response = await handler(request(input));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

function request(body: unknown, authorization = "Bearer test-token") {
  return new Request("http://localhost:3001/api/commands/today/add-later", {
    method: "POST", body: JSON.stringify(body), headers: { Authorization: authorization },
  });
}

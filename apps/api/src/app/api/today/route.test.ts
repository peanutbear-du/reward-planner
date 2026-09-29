import type { TodayResponse } from "@reward-planner/types";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequestContext } from "../../../auth/authenticated-request";
import { createTodayGetHandler } from "./handler";

const responseBody: TodayResponse = {
  date: "2026-09-29",
  timezone: null,
  dailyPlan: null,
  items: { mustDo: [], plan: [], addedLater: [] },
  schedule: { timedTasks: [], calendarEvents: [] },
  dailyStatus: { available: false },
  activeProjects: { available: false, items: [] },
};

const authenticatedContext = {
  supabase: {},
} as AuthenticatedRequestContext;

describe("GET /api/today", () => {
  it("returns 400 when date is missing or invalid", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const query = vi.fn(async () => responseBody);
    const handler = createTodayGetHandler({ authenticate, query });

    const missing = await handler(request("", "valid-token"));
    const invalid = await handler(
      request("?date=2026-02-29", "valid-token"),
    );

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 401 when the Bearer token is missing", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const query = vi.fn(async () => responseBody);
    const handler = createTodayGetHandler({ authenticate, query });

    const response = await handler(request("?date=2026-09-29"));

    expect(response.status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 401 when Supabase rejects the token", async () => {
    const authenticate = vi.fn(async () => null);
    const query = vi.fn(async () => responseBody);
    const handler = createTodayGetHandler({ authenticate, query });

    const response = await handler(
      request("?date=2026-09-29", "invalid-token"),
    );

    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("accepts a valid date and returns a private no-store response", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const query = vi.fn(async () => responseBody);
    const handler = createTodayGetHandler({ authenticate, query });

    const response = await handler(
      request("?date=2026-09-29", "valid-token"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(responseBody);
    expect(query).toHaveBeenCalledWith(authenticatedContext, "2026-09-29");
  });

  it("rejects a client-supplied user_id instead of trusting it", async () => {
    const authenticate = vi.fn(async () => authenticatedContext);
    const query = vi.fn(async () => responseBody);
    const handler = createTodayGetHandler({ authenticate, query });

    const response = await handler(
      request("?date=2026-09-29&user_id=another-user", "valid-token"),
    );

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

function request(query: string, accessToken?: string) {
  return new Request(`http://localhost:3001/api/today${query}`, {
    headers: accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
        }
      : undefined,
  });
}

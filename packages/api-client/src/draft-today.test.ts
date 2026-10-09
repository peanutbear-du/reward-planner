import { describe, expect, it, vi } from "vitest";

import { DraftTodayApiClientError, upsertDraftTodayItem, removeDraftTodayItem } from "./draft-today";

const identity = { date: "2026-10-03", taskId: "10000000-0000-4000-8000-000000000001" };

describe("Draft Today API client", () => {
  it("sends the two commands with Bearer auth and exact bodies", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    const options = { apiBaseUrl: "http://localhost:3001", accessToken: "test-token", fetchImplementation };
    await upsertDraftTodayItem({ ...options, input: { ...identity, priority: "must_do" } });
    await removeDraftTodayItem({ ...options, input: identity });
    for (const [index, command] of ["upsert-item", "remove-item"].entries()) {
      const [url, init] = fetchImplementation.mock.calls[index];
      expect(String(url)).toBe(`http://localhost:3001/api/commands/today/draft/${command}`);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
      expect(JSON.parse(String(init?.body))).toEqual(index === 0
        ? { ...identity, priority: "must_do" } : identity);
    }
  });

  it("exposes only status on a committed-plan conflict", async () => {
    await expect(upsertDraftTodayItem({
      apiBaseUrl: "http://localhost:3001",
      accessToken: "test-token",
      input: { ...identity, priority: "plan" },
      fetchImplementation: async () => Response.json({ error: "sensitive detail" }, { status: 409 }),
    })).rejects.toEqual(new DraftTodayApiClientError(409));
  });
});

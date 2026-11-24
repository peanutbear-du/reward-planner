import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getProjects } from "../../../features/project/get-projects";
import { createProjectsGetHandler } from "./handler";

const endpoint = "http://localhost/api/projects";
const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";

function setup() {
  const project = {
    title: "First", status: "active", scale: "small", deadline: "2026-12-01",
    reward_pool: 4, next_milestone: [{ id: "m", title: "Dated", due_date: "2026-11-30" }],
    next_action: { id: "t", title: "Real task" },
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const bearer = new Headers(init?.headers).get("authorization");
    if (bearer === "Bearer other-owner") return Response.json([]);
    return Response.json(url.searchParams.has("id")
      ? [{ ...project, id: secondId, next_milestone: [], next_action: null }]
      : [{ ...project, id: firstId }, { ...project, id: secondId }]);
  });
  const authenticate = vi.fn(async (token: string) => token === "expired" ? null : ({
    supabase: createClient("http://127.0.0.1:1111", "fixture", {
      global: { fetch, headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  }));
  return { handler: createProjectsGetHandler({
    authenticate,
    query: (context, query, signal) => getProjects(context.supabase, query, signal),
  }), authenticate, fetch };
}

describe("GET /api/projects", () => {
  it("authenticates and embeds one pending Milestone and the linked Task in the page query", async () => {
    const { handler, fetch } = setup();
    const res = await handler(new Request(endpoint + "?limit=1&status=active", { headers: { Authorization: "Bearer owner" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      projects: [{
        id: firstId, title: "First", status: "active", scale: "small", rewardPool: 4, deadline: "2026-12-01",
        nextMilestone: { id: "m", title: "Dated", dueDate: "2026-11-30" },
        nextAction: { id: "t", title: "Real task" },
      }],
      nextCursor: firstId,
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [input, init] = fetch.mock.calls[0];
    const params = new URL(String(input)).searchParams;
    expect(params.get("select")).toContain("next_action:tasks!projects_next_action_task_owner_fk");
    expect(params.get("select")).toContain("next_milestone:milestones!milestones_project_owner_fk");
    expect(params.get("next_milestone.status")).toBe("eq.pending");
    expect(params.get("next_milestone.order")).toBe("due_date.asc.nullslast,created_at.asc,id.asc");
    expect(params.get("next_milestone.limit")).toBe("1");
    expect(params.get("order")).toBe("id.asc");
    expect(params.get("limit")).toBe("2");
    expect(params.get("status")).toBe("eq.active");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer owner");
  });

  it("advances with an exclusive cursor and keeps Projects with no pending Milestone", async () => {
    const { handler, fetch } = setup();
    const response = await handler(new Request(endpoint + "?limit=1&cursor=" + firstId, { headers: { Authorization: "Bearer owner" } }));
    expect(await response.json()).toMatchObject({ projects: [{ id: secondId, nextMilestone: null, nextAction: null }], nextCursor: null });
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get("id")).toBe("gt." + firstId);
  });

  it("queries with the current principal and forwards the fixture's owner-only result", async () => {
    const { handler, fetch } = setup();
    const response = await handler(new Request(endpoint + "?cursor=" + firstId, { headers: { Authorization: "Bearer other-owner" } }));
    expect(await response.json()).toEqual({ projects: [], nextCursor: null });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer other-owner");
  });

  it.each(["", "Bearer expired"])("rejects missing or expired authentication (%s)", async token => {
    const { handler, fetch } = setup();
    expect((await handler(new Request(endpoint, { headers: { Authorization: token } }))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["limit=0", "limit=51", "limit=2.5", "cursor=bad", "status=archived", "status=active&status=paused", "userId=other"])(
    "rejects invalid query %s", async query => {
      const { handler, fetch } = setup();
      expect((await handler(new Request(endpoint + "?" + query, { headers: { Authorization: "Bearer owner" } }))).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

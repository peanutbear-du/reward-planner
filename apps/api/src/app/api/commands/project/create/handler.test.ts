import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { CreateProjectCommandError } from "../../../../../features/project/create-project";
import { createProjectPostHandler } from "./handler";

const context = { supabase: {} } as AuthenticatedRequestContext;
const input = { title: " Trip ", scale: "medium", deadline: "2028-02-29", milestones: [{ title: " Book " }] };

function request(body: unknown = input, authorization = "Bearer session") {
  return new Request("http://localhost/api/commands/project/create", {
    method: "POST",
    headers: { authorization },
    body: JSON.stringify(body),
  });
}

describe("Create Project HTTP handler", () => {
  it.each(["small", "medium", "large", "major"])("accepts the %s scale with normalized input", async (scale) => {
    const authenticate = vi.fn(async () => context);
    const result = { data: { project: { scale } }, effects: ["project_created"] };
    const command = vi.fn().mockResolvedValue(result);
    const response = await createProjectPostHandler({ authenticate, command })(request({ ...input, scale }));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(result);
    expect(authenticate).toHaveBeenCalledExactlyOnceWith("session");
    expect(command).toHaveBeenCalledExactlyOnceWith(context, {
      title: "Trip", scale, deadline: "2028-02-29", milestones: [{ title: "Book", dueDate: null }],
    });
  });

  it.each([
    ["missing milestones", { ...input, milestones: undefined }],
    ["empty milestones", { ...input, milestones: [] }],
    ["invalid scale", { ...input, scale: "huge" }],
    ["blank project title", { ...input, title: " " }],
    ["invalid deadline", { ...input, deadline: "2026-02-29" }],
    ["forged project owner", { ...input, userId: "other" }],
    ["forged pool", { ...input, rewardPool: 100 }],
    ["forged status", { ...input, status: "completed" }],
    ["blank milestone title", { ...input, milestones: [{ title: "\u00a0" }] }],
    ["invalid due date", { ...input, milestones: [{ title: "Book", dueDate: "yesterday" }] }],
    ["forged milestone owner", { ...input, milestones: [{ title: "Book", user_id: "other" }] }],
    ["forged milestone project", { ...input, milestones: [{ title: "Book", projectId: "other" }] }],
    ["forged milestone amount", { ...input, milestones: [{ title: "Book", rewardValue: 100 }] }],
  ])("rejects %s before authentication", async (_label, body) => {
    const authenticate = vi.fn();
    const command = vi.fn();
    const response = await createProjectPostHandler({ authenticate, command })(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
    expect(authenticate).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await createProjectPostHandler()(new Request("http://localhost", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
  });

  it.each(["", "Basic session", "Bearer a b", "Bearer expired"])("blocks writes with authorization %j", async (token) => {
    const command = vi.fn();
    const authenticate = vi.fn().mockResolvedValue(null);
    const response = await createProjectPostHandler({ authenticate, command })(request(input, token));
    expect(response.status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401], ["INVALID_PROJECT_REQUEST", 400], ["PROJECT_CREATION_UNAVAILABLE", 503],
  ] as const)("maps %s to HTTP %d", async (code, status) => {
    const command = vi.fn().mockRejectedValue(new CreateProjectCommandError(code));
    const response = await createProjectPostHandler({ authenticate: async () => context, command })(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it("hides unexpected database details", async () => {
    const command = vi.fn().mockRejectedValue(new Error("private SQL details"));
    const response = await createProjectPostHandler({ authenticate: async () => context, command })(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

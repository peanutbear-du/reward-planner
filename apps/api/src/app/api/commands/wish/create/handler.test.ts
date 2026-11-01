import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { CreateWishCommandError } from "../../../../../features/wish/create-wish";
import { createWishPostHandler } from "./handler";

const input = { title: "Camera", target: 60 };
const context = { supabase: {} } as AuthenticatedRequestContext;
const request = (body: unknown = input, authorization = "Bearer session") => new Request("http://localhost/api/commands/wish/create", {
  method: "POST", headers: { authorization }, body: JSON.stringify(body),
});
describe("Create Wish HTTP handler", () => {
  it("authenticates and passes normalized input plus user context, returning 201 private/no-store", async () => {
    const command = vi.fn(), authenticate = vi.fn(async () => context);
    command.mockResolvedValue({ data: { wish: { id: "fixture" } }, effects: ["wish_created"] });
    const response = await createWishPostHandler({ authenticate, command })(request({ ...input, title: " Camera " }));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: { wish: { id: "fixture" } }, effects: ["wish_created"] });
    expect(authenticate).toHaveBeenCalledWith("session");
    expect(command).toHaveBeenCalledWith(context, { ...input, referencePrice: null, why: null });
  });
  it.each(["", "Basic session", "Bearer a b"])("rejects invalid Bearer %s", async (token) => {
    const authenticate = vi.fn(), command = vi.fn();
    expect((await createWishPostHandler({ authenticate, command })(request(input, token))).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
  });
  it("rejects expired identity before persistence", async () => {
    const command = vi.fn();
    expect((await createWishPostHandler({ authenticate: async () => null, command })(request())).status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });
  it.each([{}, { ...input, status: "unlocking" }, { ...input, userId: "other" }, { ...input, coverPath: "cover" },
    { ...input, target: 1.5 }, { ...input, referencePrice: -1 }, { ...input, title: " " },
  ])("rejects invalid/forged fields before authentication %#", async (body) => {
    const authenticate = vi.fn(), command = vi.fn();
    expect((await createWishPostHandler({ authenticate, command })(request(body))).status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await createWishPostHandler()(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
  });
  it.each([ ["AUTHENTICATION_REQUIRED",401], ["INVALID_WISH_REQUEST",400], ["WISH_CREATION_UNAVAILABLE",503] ] as const)("maps %s", async (code,status) => {
    const response = await createWishPostHandler({ authenticate: async () => context, command: async () => { throw new CreateWishCommandError(code); } })(request());
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: code });
  });
  it.each(["auth", "command"])("hides unexpected %s failures", async (stage) => {
    const response = await createWishPostHandler({ authenticate: async () => { if (stage === "auth") throw Error("private key"); return context; },
      command: async () => { throw Error("private SQL"); } })(request());
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

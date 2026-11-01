import { describe, expect, it, vi } from "vitest";
import { createWish } from "./create-wish";

const input = { title: "Camera", target: 137 };
const options = { apiBaseUrl: "http://localhost:3001", accessToken: "session", input };
describe("Create Wish client", () => {
  it("posts once with Bearer and optional abort signal", async () => {
    const signal = new AbortController().signal, body = { data: { wish: { id: "fixture" } }, effects: ["wish_created"] };
    const fetchImplementation = vi.fn(async () => Response.json(body, { status: 201 }));
    expect(await createWish({ ...options, signal, fetchImplementation })).toEqual(body);
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(new URL("http://localhost:3001/api/commands/wish/create"), expect.objectContaining({
      method: "POST", cache: "no-store", signal, body: JSON.stringify(input), headers: expect.objectContaining({ Authorization: "Bearer session" }),
    }));
  });
  it.each([400, 401, 503, 500])("preserves HTTP %s without auto-retry", async (status) => {
    const fetchImplementation = vi.fn(async () => Response.json({ error: "DOMAIN_ERROR" }, { status }));
    await expect(createWish({ ...options, fetchImplementation })).rejects.toMatchObject({ status, code: "DOMAIN_ERROR" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
  it("handles non-JSON failure", async () => {
    await expect(createWish({ ...options, fetchImplementation: async () => new Response("unavailable", { status: 503 }) })).rejects.toMatchObject({ status: 503, code: null });
  });
  it("does not retry lost-response/network errors", async () => {
    const fetchImplementation = vi.fn(async () => { throw Error("Network unavailable"); });
    await expect(createWish({ ...options, fetchImplementation })).rejects.toThrow("Network unavailable");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

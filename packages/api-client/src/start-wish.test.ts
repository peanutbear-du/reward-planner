import { describe, expect, it, vi } from "vitest";
import { startWish, switchWish } from "./start-wish";

const options = { apiBaseUrl: "http://localhost:3001", accessToken: "test-session", input: { wishId: "70000000-0000-4000-8000-000000000101" } };
describe("Wish lifecycle HTTP client", () => {
  it.each([[startWish, "start"], [switchWish, "switch"]] as const)("dispatches exactly once to %s", async (command, mode) => {
    const result = { data: { changed: false }, effects: [] }, signal = new AbortController().signal;
    const fetchImplementation = vi.fn(async () => Response.json(result));
    expect(await command({ ...options, signal, fetchImplementation })).toEqual(result);
    const [url, init] = fetchImplementation.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe(`/api/commands/wish/${mode}`); expect(init).toMatchObject({ method: "POST", cache: "no-store", signal, body: JSON.stringify(options.input) });
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-session" }); expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 404, 409, 503, 500])("preserves HTTP %s without retry", async status => {
    const fetchImplementation = vi.fn(async () => Response.json({ error: "WISH_START_NOT_ALLOWED" }, { status }));
    await expect(startWish({ ...options, fetchImplementation })).rejects.toMatchObject({ status, code: "WISH_START_NOT_ALLOWED" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
  it("does not retry a lost/aborted response", async () => {
    const fetchImplementation = vi.fn(async () => { throw Error("transport outcome unknown"); });
    await expect(switchWish({ ...options, fetchImplementation })).rejects.toThrow("unknown"); expect(fetchImplementation).toHaveBeenCalledTimes(1);
    await expect(startWish({ ...options, fetchImplementation: async () => new Response("offline", { status: 503 }) })).rejects.toMatchObject({ status: 503, code: null });
  });
});

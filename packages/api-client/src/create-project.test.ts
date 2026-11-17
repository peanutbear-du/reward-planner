import { describe, expect, it, vi } from "vitest";
import { createProject } from "./create-project";

const options = {
  apiBaseUrl: "https://example.test",
  accessToken: "test-session",
  input: { title: "Trip", scale: "medium" as const, milestones: [{ title: "Book" }] },
};

describe("Create Project API client", () => {
  it("sends the ordered request and forwards the server response", async () => {
    const signal = new AbortController().signal;
    const input = { ...options.input, milestones: [{ title: "Book" }, { title: "Pack" }] };
    const result = { data: { project: { rewardPool: 8 } }, effects: ["project_created"] };
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json(result, { status: 201 }));
    await expect(createProject({ ...options, input, signal, fetchImplementation })).resolves.toEqual(result);
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(new URL("https://example.test/api/commands/project/create"), {
      method: "POST", cache: "no-store", signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer test-session" },
      body: JSON.stringify(input),
    });
  });

  it("exposes status and public error code without retrying", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({ error: "PROJECT_CREATION_UNAVAILABLE" }, { status: 503 }));
    await expect(createProject({ ...options, fetchImplementation })).rejects.toMatchObject({
      status: 503, code: "PROJECT_CREATION_UNAVAILABLE",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { executeCreateProject } from "./create-project";
import { createSupabaseCreateProjectCommand } from "./supabase-create-project-command";

const input = {
  title: "Trip",
  scale: "medium" as const,
  milestones: [{ title: "Book" }, { title: "Pack", dueDate: "2026-11-20" }, { title: "Depart" }],
};
const project = {
  id: randomUUID(), title: "Trip", scale: "medium", status: "active", rewardPool: 8,
  deadline: null, scaleLocked: false, createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z",
};
const milestones = input.milestones.map(({ title, dueDate }, index) => ({
  id: randomUUID(), projectId: project.id, title, status: "pending", dueDate: dueDate ?? null, rewardValue: [2, 2, 4][index],
}));

function adapter(rpc: unknown) {
  return createSupabaseCreateProjectCommand({ rpc } as SupabaseClient);
}

describe("Create Project domain and Supabase contract (mock only)", () => {
  it("uses one authenticated RPC and preserves the ordered database allocation", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        project: { ...project, userId: "private" },
        milestones: milestones.map((milestone) => ({ ...milestone, user_id: "private" })),
      },
      error: null,
    });
    const response = await executeCreateProject({ ...input, title: " Trip " }, adapter(rpc));
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_project", {
      p_title: "Trip", p_scale: "medium", p_deadline: null,
      p_milestones: [
        { title: "Book", dueDate: null }, { title: "Pack", dueDate: "2026-11-20" }, { title: "Depart", dueDate: null },
      ],
    });
    expect(response).toEqual({ data: { project, milestones }, effects: ["project_created"] });
  });

  it("uses the returned snapshot and accepts zero-point Milestones", async () => {
    const data = { project: { ...project, rewardPool: 2 }, milestones: milestones.map(
      (milestone, index) => ({ ...milestone, rewardValue: index === 2 ? 2 : 0 }),
    ) };
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(executeCreateProject(input, adapter(rpc))).resolves.toMatchObject({ data });
  });

  it("blocks invalid input before persistence", async () => {
    const command = { execute: vi.fn() };
    await expect(executeCreateProject({ ...input, milestones: [] }, command)).rejects.toMatchObject({
      code: "INVALID_PROJECT_REQUEST",
    });
    expect(command.execute).not.toHaveBeenCalled();
  });

  it.each(["AUTHENTICATION_REQUIRED", "INVALID_PROJECT_REQUEST"])("preserves %s", async (message) => {
    const rpc = vi.fn().mockResolvedValue({ error: { message } });
    await expect(executeCreateProject(input, adapter(rpc))).rejects.toMatchObject({ code: message });
  });

  it("maps a missing RPC to unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "PGRST202" } });
    await expect(executeCreateProject(input, adapter(rpc))).rejects.toMatchObject({ code: "PROJECT_CREATION_UNAVAILABLE" });
  });

  it.each([
    null,
    { project, milestones: milestones.slice(1) },
    { project, milestones: [...milestones].reverse() },
    { project, milestones: [{ ...milestones[0], projectId: randomUUID() }, ...milestones.slice(1)] },
  ])("rejects incomplete or mismatched persistence result %#", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(executeCreateProject(input, adapter(rpc))).rejects.toThrow("invalid result");
  });

  it("propagates an insertion failure without retry or success effects", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "23514", message: "constraint failure" } });
    await expect(executeCreateProject(input, adapter(rpc))).rejects.toThrow("Failed to execute Create Project");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

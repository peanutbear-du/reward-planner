import { createdProjectDataSchema } from "@reward-planner/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CreateProjectCommandError, type CreateProjectCommand } from "./create-project";

export function createSupabaseCreateProjectCommand(supabase: SupabaseClient): CreateProjectCommand {
  return {
    async execute(input) {
      const { data, error } = await supabase.rpc("create_project", {
        p_title: input.title,
        p_scale: input.scale,
        p_deadline: input.deadline ?? null,
        p_milestones: input.milestones,
      });

      if (error) {
        if (error.message === "AUTHENTICATION_REQUIRED" || error.message === "INVALID_PROJECT_REQUEST") {
          throw new CreateProjectCommandError(error.message);
        }
        if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code)) {
          throw new CreateProjectCommandError("PROJECT_CREATION_UNAVAILABLE");
        }
        throw new Error("Failed to execute Create Project.", { cause: error });
      }

      const parsed = createdProjectDataSchema.safeParse(data);
      if (!parsed.success) throw new Error("Create Project returned an invalid result.");

      const { project, milestones } = parsed.data;
      if (project.title !== input.title || project.scale !== input.scale || project.deadline !== (input.deadline ?? null)
        || milestones.length !== input.milestones.length
        || milestones.some((milestone, index) => {
          const submitted = input.milestones[index];
          return milestone.projectId !== project.id
            || milestone.title !== submitted.title || milestone.dueDate !== (submitted.dueDate ?? null);
        })) {
        throw new Error("Create Project returned an invalid result.");
      }
      return parsed.data;
    },
  };
}

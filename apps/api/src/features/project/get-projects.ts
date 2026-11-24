import type { ProjectsQuery } from "@reward-planner/schemas";
import type { ProjectOverview, ProjectsResponse } from "@reward-planner/types";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ProjectRow {
  id: string;
  title: string;
  status: ProjectOverview["status"];
  scale: ProjectOverview["scale"];
  reward_pool: number;
  deadline: string | null;
  next_milestone: { id: string; title: string; due_date: string | null }[];
  next_action: ProjectOverview["nextAction"];
}

export async function getProjects(
  supabase: SupabaseClient,
  { status, cursor, limit }: ProjectsQuery,
  signal: AbortSignal,
): Promise<ProjectsResponse> {
  const query = supabase.from("projects")
    .select(`
      id,title,status,scale,reward_pool,deadline,
      next_milestone:milestones!milestones_project_owner_fk(id,title,due_date),
      next_action:tasks!projects_next_action_task_owner_fk(id,title)
    `)
    .eq("next_milestone.status", "pending")
    .order("due_date", { referencedTable: "next_milestone", ascending: true, nullsFirst: false })
    .order("created_at", { referencedTable: "next_milestone", ascending: true })
    .order("id", { referencedTable: "next_milestone", ascending: true })
    .limit(1, { referencedTable: "next_milestone" })
    .order("id", { ascending: true })
    .limit(limit + 1)
    .abortSignal(signal);

  if (status) query.eq("status", status);
  if (cursor) query.gt("id", cursor);
  const { data, error } = await query.returns<ProjectRow[]>();
  if (error || !data) throw new Error("Could not read projects.", { cause: error });

  const page = data.slice(0, limit);
  return {
    projects: page.map(row => {
      const milestone = row.next_milestone[0];
      return {
        id: row.id, title: row.title, status: row.status, scale: row.scale,
        rewardPool: row.reward_pool, deadline: row.deadline,
        nextMilestone: milestone ? { id: milestone.id, title: milestone.title, dueDate: milestone.due_date } : null,
        nextAction: row.next_action,
      };
    }),
    nextCursor: data.length > limit ? page.at(-1)!.id : null,
  };
}

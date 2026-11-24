import type { ProjectScale } from "./create-project";

export type ProjectStatus = "active" | "paused" | "completed";

export interface ProjectOverview {
  id: string;
  title: string;
  status: ProjectStatus;
  scale: ProjectScale;
  rewardPool: number;
  deadline: string | null;
  nextMilestone: { id: string; title: string; dueDate: string | null } | null;
  nextAction: { id: string; title: string } | null;
}

export interface ProjectsResponse {
  projects: ProjectOverview[];
  nextCursor: string | null;
}

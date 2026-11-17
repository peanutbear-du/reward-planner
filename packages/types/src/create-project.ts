export type ProjectScale = "small" | "medium" | "large" | "major";

export interface InitialMilestoneRequest {
  title: string;
  dueDate?: string | null;
}

export interface CreateProjectRequest {
  title: string;
  scale: ProjectScale;
  deadline?: string | null;
  milestones: InitialMilestoneRequest[];
}

export interface CreatedProjectDto {
  id: string;
  title: string;
  scale: ProjectScale;
  status: "active";
  rewardPool: number;
  deadline: string | null;
  scaleLocked: false;
  createdAt: string;
  updatedAt: string;
}

export interface InitialMilestoneDto {
  id: string;
  projectId: string;
  title: string;
  status: "pending";
  rewardValue: number;
  dueDate: string | null;
}

export interface CreateProjectResponse {
  data: { project: CreatedProjectDto; milestones: InitialMilestoneDto[] };
  effects: ["project_created"];
}

export type CreateProjectErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_PROJECT_REQUEST"
  | "PROJECT_CREATION_UNAVAILABLE";

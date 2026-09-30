export interface CreateTaskSchedule {
  plannedDate: string;
  startTime: string | null;
  endTime: string | null;
}

export interface CreateTaskRequest {
  title: string;
  schedule: CreateTaskSchedule | null;
}

export interface TaskDto {
  id: string;
  title: string;
  status: "open";
  completedAt: null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPlanningItemDto {
  id: string;
  taskId: string;
  plannedDate: string;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskResponse {
  data: {
    task: TaskDto;
    planningItem: TaskPlanningItemDto | null;
  };
  effects: ["task_created"];
}

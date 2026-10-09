export interface CommitDailyPlanRequest {
  date: string;
}

export interface CommitDailyPlanResponse {
  data: {
    date: string;
    dailyPlan: {
      id: string;
      status: "committed";
      snapshotCreatedAt: string;
    };
  };
  effects: ["daily_plan_committed"];
}

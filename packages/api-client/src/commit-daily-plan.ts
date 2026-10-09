import type { CommitDailyPlanRequest, CommitDailyPlanResponse } from "@reward-planner/types";

export interface CommitDailyPlanOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: CommitDailyPlanRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class CommitDailyPlanApiClientError extends Error {
  constructor(readonly status: number) {
    super(`Commit Daily Plan request failed with status ${status}.`);
    this.name = "CommitDailyPlanApiClientError";
  }
}

export async function commitDailyPlan({
  apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch,
}: CommitDailyPlanOptions): Promise<CommitDailyPlanResponse> {
  const response = await fetchImplementation(
    new URL("/api/commands/today/commit", apiBaseUrl),
    {
      method: "POST",
      body: JSON.stringify(input),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      signal,
    },
  );
  if (!response.ok) {
    throw new CommitDailyPlanApiClientError(response.status);
  }
  return await response.json() as CommitDailyPlanResponse;
}

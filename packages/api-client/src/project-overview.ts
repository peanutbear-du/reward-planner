import type { ProjectsResponse, ProjectStatus } from "@reward-planner/types";

export async function getProjects({
  apiBaseUrl, accessToken, status, cursor, signal, fetchImplementation = fetch,
}: {
  apiBaseUrl: string;
  accessToken: string;
  status?: ProjectStatus;
  cursor?: string;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}): Promise<ProjectsResponse> {
  const url = new URL("/api/projects", apiBaseUrl);
  if (status) url.searchParams.set("status", status);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetchImplementation(url, {
    cache: "no-store",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!response.ok) {
    throw Object.assign(new Error("Could not read projects."), { status: response.status });
  }
  return await response.json() as ProjectsResponse;
}

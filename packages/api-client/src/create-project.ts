import type { CreateProjectRequest, CreateProjectResponse } from "@reward-planner/types";

export interface CreateProjectOptions {
  apiBaseUrl: string;
  accessToken: string;
  input: CreateProjectRequest;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export class CreateProjectApiClientError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`Create Project request failed with status ${status}.`);
    this.name = "CreateProjectApiClientError";
  }
}

export async function createProject({
  apiBaseUrl, accessToken, input, signal, fetchImplementation = fetch,
}: CreateProjectOptions): Promise<CreateProjectResponse> {
  // A lost response may already be committed. Send only one request.
  const response = await fetchImplementation(new URL("/api/commands/project/create", apiBaseUrl), {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    let code: string | null = null;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        code = body.error;
      }
    } catch {
      // A transport failure can have a non-JSON body.
    }
    throw new CreateProjectApiClientError(response.status, code);
  }

  return await response.json() as CreateProjectResponse;
}

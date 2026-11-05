import { wishCoverRequestSchema } from "@reward-planner/schemas";
import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../../../auth/authenticated-request";
import { createCoverReader } from "../../../../features/wish/supabase-wish-cover";
import { getWishCoverUrl, type CoverReader } from "../../../../features/wish/wish-cover";
import { bearer, coverFailure, coverJson } from "../../../../features/wish/cover-http";

interface Dependencies {
  authenticate(token: string): Promise<AuthenticatedRequestContext | null>;
  reader(context: AuthenticatedRequestContext): CoverReader;
}
const defaults: Dependencies = { authenticate: authenticateAccessToken, reader: (context) => createCoverReader(context.supabase) };
export function wishCoverGetHandler(deps = defaults) {
  return async (request: Request) => {
    const token = bearer(request); if (!token) return coverJson({ error: "UNAUTHORIZED" }, 401);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = wishCoverRequestSchema.safeParse(query); if (!parsed.success) return coverJson({ error: "INVALID_REQUEST" }, 400);
    try {
      const context = await deps.authenticate(token); if (!context) return coverJson({ error: "UNAUTHORIZED" }, 401);
      return coverJson(await getWishCoverUrl(parsed.data.wishId, deps.reader(context)));
    } catch (error) { return coverFailure(error); }
  };
}

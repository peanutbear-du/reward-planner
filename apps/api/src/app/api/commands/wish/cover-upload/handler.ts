import { wishCoverRequestSchema } from "@reward-planner/schemas";
import { authenticateAccessToken, type AuthenticatedRequestContext } from "../../../../../auth/authenticated-request";
import { createCoverReader, createServerCoverWriter } from "../../../../../features/wish/supabase-wish-cover";
import { uploadWishCover, WishCoverError, type CoverReader, type CoverWriter, type CoverAudit } from "../../../../../features/wish/wish-cover";
import { bearer, coverFailure, coverForm, coverJson } from "../../../../../features/wish/cover-http";

interface Dependencies {
  authenticate(token: string): Promise<AuthenticatedRequestContext | null>;
  reader(context: AuthenticatedRequestContext): CoverReader;
  writer(): CoverWriter;
  audit: CoverAudit;
}
const defaults: Dependencies = {
  authenticate: authenticateAccessToken, reader: (context) => createCoverReader(context.supabase), writer: createServerCoverWriter,
  audit: (event) => console.error(JSON.stringify(event)),
};
export function uploadWishCoverHandler(deps = defaults) {
  return async (request: Request) => {
    const token = bearer(request); if (!token) return coverJson({ error: "UNAUTHORIZED" }, 401);
    try {
      const context = await deps.authenticate(token); if (!context) return coverJson({ error: "UNAUTHORIZED" }, 401);
      const form = await coverForm(request);
      if ([...form.keys()].some((key) => !["wishId", "file"].includes(key)) || form.getAll("wishId").length !== 1 || form.getAll("file").length !== 1) throw new WishCoverError("INVALID_REQUEST");
      const parsed = wishCoverRequestSchema.safeParse({ wishId: form.get("wishId") }), file = form.get("file");
      if (!parsed.success || !file || typeof file === "string") throw new WishCoverError("INVALID_REQUEST");
      return coverJson(await uploadWishCover({ wishId: parsed.data.wishId, bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type }, deps.reader(context), deps.writer, deps.audit), 201);
    } catch (error) { return coverFailure(error); }
  };
}

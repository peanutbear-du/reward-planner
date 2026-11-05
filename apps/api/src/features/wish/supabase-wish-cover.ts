import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CoverLinkError, StorageUploadError, type CoverReader, type CoverWriter } from "./wish-cover";

const bucket = "wish-covers";
export function createCoverReader(user: SupabaseClient): CoverReader {
  return {
    async wish(id) {
      const { data, error } = await user.from("wishes").select("id,user_id,cover_path").eq("id", id).maybeSingle();
      if (error) throw Error("Unable to read owned Wish");
      if (!data) return null;
      if (typeof data.id !== "string" || typeof data.user_id !== "string" || !(data.cover_path === null || typeof data.cover_path === "string")) throw Error("Invalid Wish result");
      return { id: data.id, userId: data.user_id, coverPath: data.cover_path };
    },
    async signedUrl(path) {
      const { data, error } = await user.storage.from(bucket).createSignedUrl(path, 300);
      if (error || !data?.signedUrl) throw Error("Cannot sign private cover");
      return data.signedUrl;
    },
  };
}

// Server only. Constructed lazily AFTER user-scoped ownership and byte checks.
// service-role bypasses RLS; safety here depends on the verified canonical path.
export function createServerCoverWriter(): CoverWriter {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error("Server cover Storage configuration unavailable");
  return coverWriter(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
}
export function coverWriter(server: SupabaseClient): CoverWriter {
  return {
    async upload(path, bytes) {
      const { data, error } = await server.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
      if (error) {
        const status = Number("statusCode" in error ? error.statusCode : 0);
        // Timeouts/connection closures (including 408/499) do not prove absence.
        const definite = [400, 401, 403, 404, 409, 413, 415, 422, 429].includes(status);
        throw new StorageUploadError(definite, status === 409 || error.message === "The resource already exists");
      }
      if (data?.path !== path) throw new StorageUploadError(false);
    },
    async attach(wish) {
      const { data, error } = await server.rpc("attach_wish_cover", { p_wish_id: wish.id, p_user_id: wish.userId });
      // Only known RPC rejections establish rollback. In particular 40003
      // (statement_completion_unknown) must never authorize compensation.
      if (error) throw new CoverLinkError(["22023", "42501", "P0001", "P0002"].includes(error.code ?? ""));
      if (data?.wishId !== wish.id || data?.coverPath !== `${wish.userId}/${wish.id}.jpg`) throw new CoverLinkError(false);
    },
    async remove(path) {
      const { error } = await server.storage.from(bucket).remove([path]);
      if (error) throw Error("Cover cleanup not confirmed");
    },
  };
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthenticatedRequestContext {
  supabase: SupabaseClient;
}

export async function authenticateAccessToken(
  accessToken: string,
): Promise<AuthenticatedRequestContext | null> {
  const supabase = createRequestSupabaseClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return null;
  }

  return { supabase };
}

function createRequestSupabaseClient(accessToken: string) {
  const supabaseUrl = getRequiredEnvironmentVariable("SUPABASE_URL");
  const supabaseAnonKey = getRequiredEnvironmentVariable("SUPABASE_ANON_KEY");

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function getRequiredEnvironmentVariable(name: "SUPABASE_URL" | "SUPABASE_ANON_KEY") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}.`);
  }

  return value;
}

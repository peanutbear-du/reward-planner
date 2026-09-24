import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

import { getSupabaseClient } from "../lib/supabase";

export interface AuthCredentials {
  email: string;
  password: string;
}

export function signUp(credentials: AuthCredentials) {
  return getSupabaseClient().auth.signUp(credentials);
}

export function signIn(credentials: AuthCredentials) {
  return getSupabaseClient().auth.signInWithPassword(credentials);
}

export function signOut() {
  return getSupabaseClient().auth.signOut({ scope: "local" });
}

export function restoreSession() {
  return getSupabaseClient().auth.getSession();
}

export function subscribeToAuthState(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  const { data } = getSupabaseClient().auth.onAuthStateChange(callback);

  return data.subscription;
}

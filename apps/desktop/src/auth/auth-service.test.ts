import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => ({ auth: authMocks }),
}));

import {
  restoreSession,
  signIn,
  signOut,
  signUp,
  subscribeToAuthState,
} from "./auth-service";

describe("auth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs up with email and password", async () => {
    const response = { data: { session: null, user: null }, error: null };
    authMocks.signUp.mockResolvedValue(response);

    await expect(
      signUp({ email: "person@example.com", password: "password" }),
    ).resolves.toBe(response);
    expect(authMocks.signUp).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "password",
    });
  });

  it("signs in with email and password and preserves auth errors", async () => {
    const error = new Error("Invalid login credentials");
    const response = { data: { session: null, user: null }, error };
    authMocks.signInWithPassword.mockResolvedValue(response);

    await expect(
      signIn({ email: "person@example.com", password: "incorrect" }),
    ).resolves.toBe(response);
    expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "incorrect",
    });
  });

  it("signs out the current session", async () => {
    const response = { error: null };
    authMocks.signOut.mockResolvedValue(response);

    await expect(signOut()).resolves.toBe(response);
    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("restores the persisted session", async () => {
    const response = { data: { session: null }, error: null };
    authMocks.getSession.mockResolvedValue(response);

    await expect(restoreSession()).resolves.toBe(response);
    expect(authMocks.getSession).toHaveBeenCalledOnce();
  });

  it("subscribes to auth state changes", () => {
    const subscription = { unsubscribe: vi.fn() };
    const callback = vi.fn();
    authMocks.onAuthStateChange.mockReturnValue({ data: { subscription } });

    expect(subscribeToAuthState(callback)).toBe(subscription);
    expect(authMocks.onAuthStateChange).toHaveBeenCalledWith(callback);
  });
});

import { useState, type FormEvent } from "react";

import { signIn, signUp } from "./auth-service";

interface AuthViewProps {
  sessionError: string | null;
}

type AuthMode = "sign-in" | "sign-up";

export function AuthView({ sessionError }: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isSignIn = mode === "sign-in";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = isSignIn
        ? await signIn({ email, password })
        : await signUp({ email, password });

      if (result.error) {
        setErrorMessage(result.error.message);
        return;
      }

      if (!isSignIn && !result.data.session) {
        setSuccessMessage(
          "Check your email to confirm your account before signing in.",
        );
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function switchMode() {
    setMode(isSignIn ? "sign-up" : "sign-in");
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">Reward Planner</p>
        <h1 id="auth-title">{isSignIn ? "Sign in" : "Create account"}</h1>
        <p className="supporting-copy">
          {isSignIn
            ? "Continue to your personal planning workspace."
            : "Create an account with your email and password."}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field">
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="form-field">
            Password
            <input
              type="password"
              name="password"
              autoComplete={isSignIn ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {sessionError ? (
            <p className="form-message form-message-error" role="alert">
              {sessionError}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="form-message form-message-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          {successMessage ? (
            <p className="form-message form-message-success" role="status">
              {successMessage}
            </p>
          ) : null}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? isSignIn
                ? "Signing in…"
                : "Creating account…"
              : isSignIn
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {isSignIn ? "New to Reward Planner?" : "Already have an account?"}
          <button className="text-button" type="button" onClick={switchMode}>
            {isSignIn ? "Create account" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Authentication failed.";
}

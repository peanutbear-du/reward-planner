import { useState } from "react";

import { AuthView } from "./auth/AuthView";
import { signOut } from "./auth/auth-service";
import { useAuthSession } from "./auth/use-auth-session";

export function App() {
  const { error: sessionError, isLoading, session } = useAuthSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <main className="auth-page" aria-busy="true">
        <section className="auth-panel">
          <p className="eyebrow">Reward Planner</p>
          <h1>Restoring your session</h1>
          <p className="supporting-copy">Please wait a moment.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return <AuthView sessionError={sessionError} />;
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    setSignOutError(null);

    try {
      const { error } = await signOut();

      if (error) {
        setSignOutError(error.message);
      }
    } catch (error) {
      setSignOutError(getErrorMessage(error));
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Reward Planner</div>
        <nav aria-label="Primary navigation">
          <span className="placeholder-label">Navigation</span>
        </nav>

        <div className="account-panel">
          <span className="account-email">{session.user.email}</span>
          <button
            className="secondary-button"
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
          {signOutError ? (
            <p className="form-message form-message-error" role="alert">
              {signOutError}
            </p>
          ) : null}
        </div>
      </aside>

      <main className="main-content">
        <p className="placeholder-label">Main content</p>
        <h1>Reward Planner</h1>
      </main>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Authentication failed.";
}

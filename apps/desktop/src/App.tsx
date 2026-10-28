import { lazy, Suspense, useState } from "react";

import { AuthView } from "./auth/AuthView";
import { signOut } from "./auth/auth-service";
import { useAuthSession } from "./auth/use-auth-session";
import { DesktopSidebar } from "./DesktopSidebar";

const TodayPage = lazy(() =>
  import("./today/TodayPage").then((module) => ({ default: module.TodayPage })),
);

export function App() {
  const { error: sessionError, isLoading, session } = useAuthSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <main className="auth-page" aria-busy="true">
        <section className="auth-panel">
          <p className="eyebrow">Reward Planner</p>
          <h1>正在恢复登录状态</h1>
          <p className="supporting-copy">请稍候。</p>
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
        setSignOutError("退出登录失败，请重试。");
      }
    } catch {
      setSignOutError("退出登录失败，请重试。");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="app-shell">
      <DesktopSidebar email={session.user.email} isSigningOut={isSigningOut}
        signOutError={signOutError} onSignOut={() => { void handleSignOut(); }} />

      <Suspense fallback={<main className="main-content" role="status">正在加载每日计划…</main>}>
        <TodayPage key={session.user.id} accessToken={session.access_token} />
      </Suspense>
    </div>
  );
}

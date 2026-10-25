import { lazy, Suspense, useState } from "react";

import { AuthView } from "./auth/AuthView";
import { signOut } from "./auth/auth-service";
import { useAuthSession } from "./auth/use-auth-session";

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
      <aside className="sidebar">
        <div className="brand">Reward Planner</div>
        <p className="brand-caption">把长期目标落到今天</p>
        <nav className="primary-nav" aria-label="主导航">
          <span className="nav-item nav-selected" aria-current="page">计划</span>
          <span className="nav-item" aria-disabled="true">项目<small>待开放</small></span>
          <span className="nav-item" aria-disabled="true">愿望板<small>待开放</small></span>
          <span className="nav-item" aria-disabled="true">回顾<small>待开放</small></span>
        </nav>

        <div className="account-panel">
          <div className="theme-indicator" aria-label="当前主题：蓝色">
            <span className="theme-swatch" aria-hidden="true" />
            <span>主题 · 蓝色</span>
          </div>
          <span className="account-email">{session.user.email}</span>
          <button
            className="secondary-button"
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? "正在退出…" : "退出登录"}
          </button>
          {signOutError ? (
            <p className="form-message form-message-error" role="alert">
              {signOutError}
            </p>
          ) : null}
        </div>
      </aside>

      <Suspense fallback={<main className="main-content" role="status">正在加载每日计划…</main>}>
        <TodayPage key={session.user.id} accessToken={session.access_token} />
      </Suspense>
    </div>
  );
}

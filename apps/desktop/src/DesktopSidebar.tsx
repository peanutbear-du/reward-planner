interface DesktopSidebarProps {
  email?: string;
  isSigningOut: boolean;
  signOutError: string | null;
  onSignOut: () => void;
}

export function DesktopSidebar({ email, isSigningOut, signOutError, onSignOut }: DesktopSidebarProps) {
  return <aside className="sidebar">
    <div className="brand">Reward Planner</div>
    <p className="brand-caption">把长期目标落到今天</p>
    <nav className="primary-nav" aria-label="主导航">
      <span className="nav-item nav-selected" aria-current="page">计划</span>
      <span className="nav-item" aria-disabled="true" title="项目尚未开放">项目</span>
      <span className="nav-item" aria-disabled="true" title="愿望板尚未开放">愿望板</span>
      <span className="nav-item" aria-disabled="true" title="回顾尚未开放">回顾</span>
    </nav>
    <details className="account-panel">
      <summary className="theme-indicator" aria-label="账号与主题" title="账号与主题 · 当前主题：蓝色">
        <span className="theme-swatch" aria-hidden="true" /><span>主题 · 蓝色</span>
      </summary>
      <div className="account-menu">
        <span className="account-email">{email}</span>
        <button className="secondary-button" type="button" onClick={onSignOut} disabled={isSigningOut}>
          {isSigningOut ? "正在退出…" : "退出登录"}
        </button>
        {signOutError ? <p className="form-message form-message-error" role="alert">{signOutError}</p> : null}
      </div>
    </details>
  </aside>;
}

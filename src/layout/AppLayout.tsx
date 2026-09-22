import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { UpdateNotice } from '../components/UpdateNotice';
import { DataGate, PageErrorBoundary } from './DataGate';
import { bottomNavPaths, navItems, settingsItem } from './navItems';

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const current = [...navItems, settingsItem].find((n) => n.path === location.pathname);

  // ページ移動したらメニューを閉じ、先頭へスクロール
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (current) document.title = `${current.label}｜買い物価格比較`;
  }, [current]);

  return (
    <div className="app">
      {/* PC: 左サイドバー */}
      <aside className="sidebar" aria-label="メインメニュー">
        <div className="brand">買い物価格比較</div>
        <nav data-testid="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end
              className={({ isActive }) => `side-link${item.path === '/prices/new' ? ' side-link-primary' : ''}${isActive ? ' active' : ''}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to={settingsItem.path} end className={({ isActive }) => `side-sub-link${isActive ? ' active' : ''}`}>
            {settingsItem.label}
          </NavLink>
          <p className="sidebar-note">データはこのブラウザに保存されます</p>
        </div>
      </aside>

      {/* スマホ: 上部ヘッダー */}
      <header className="topbar">
        <span className="topbar-title">{current?.label ?? '買い物価格比較'}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="メニューを開く"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" />
        </button>
      </header>

      {/* スマホ: 全ページメニュー（価格履歴・店舗はここから） */}
      {menuOpen && (
        <div className="menu-backdrop" onClick={() => setMenuOpen(false)}>
          <div
            className="menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-sheet-head">
              <span>メニュー</span>
              <button type="button" className="icon-button" aria-label="メニューを閉じる" onClick={() => setMenuOpen(false)}>
                <Icon name="close" />
              </button>
            </div>
            <nav data-testid="menu-nav">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end
                  className={({ isActive }) => `menu-link${isActive ? ' active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <NavLink
              to={settingsItem.path}
              end
              className={({ isActive }) => `menu-sub-link${isActive ? ' active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {settingsItem.label}
            </NavLink>
          </div>
        </div>
      )}

      <main className="main">
        <UpdateNotice />
        <DataGate>
          <PageErrorBoundary key={location.pathname}>
            <Outlet />
          </PageErrorBoundary>
        </DataGate>
      </main>

      {/* スマホ: 下部固定ナビ */}
      <nav className="bottom-nav" aria-label="よく使うメニュー" data-testid="bottom-nav">
        {bottomNavPaths.map((path) => {
          const item = navItems.find((n) => n.path === path)!;
          const isPrimary = path === '/prices/new';
          return (
            <NavLink
              key={path}
              to={path}
              end
              aria-label={item.label}
              className={({ isActive }) => `bottom-link${isPrimary ? ' bottom-link-primary' : ''}${isActive ? ' active' : ''}`}
            >
              <span className="bottom-icon">
                <Icon name={item.icon} size={isPrimary ? 28 : 22} />
              </span>
              <span className="bottom-label">{item.shortLabel}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

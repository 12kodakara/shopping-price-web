import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './pwa/register';
import './styles.css';

// /<リポジトリ名> のように末尾の / がないURLで開かれたら、/ 付きに直す
// （ルーターと Service Worker の範囲はどちらも /<リポジトリ名>/ のため）
const base = import.meta.env.BASE_URL;
if (base !== '/' && window.location.pathname === base.slice(0, -1)) {
  window.history.replaceState(null, '', base + window.location.search + window.location.hash);
}

// アプリ本体をキャッシュしてオフラインでも起動できるようにする（本番ビルドのみ。データは localStorage のまま）
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

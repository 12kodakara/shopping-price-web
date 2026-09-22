import { useSyncExternalStore } from 'react';

// Service Worker の登録と、新しいバージョンの検出。
// ・本番ビルド（npm run build / preview / 公開先）でだけ登録する。開発サーバー（npm run dev）では登録しない
// ・Service Worker は HTTPS か localhost でしか動かない（ブラウザの決まり）。それ以外では何もしない
// ・新しい版を見つけても自動では切り替えない。「更新する」を押したときだけ切り替えて再読み込みする
//   （入力中にいきなり画面が再読み込みされないようにするため）

type UpdateState = { available: boolean };

let state: UpdateState = { available: false };
let waitingWorker: ServiceWorker | null = null;
let reloadRequested = false;
const listeners = new Set<() => void>();

function setAvailable(worker: ServiceWorker | null) {
  waitingWorker = worker;
  state = { available: worker !== null };
  for (const l of listeners) l();
}

/** 新しいバージョンが待機中かどうか（画面の表示用） */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  ).available;
}

/** 「更新する」を押したとき: 待機中の新しい版に切り替え、切り替わったら再読み込みする */
export function applyUpdate() {
  if (!waitingWorker) return;
  reloadRequested = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

/** 前回の更新確認からこの時間が経っていれば、アプリに戻ってきたときに確認する */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;

  // 利用者が「更新する」を押した場合だけ再読み込みする（初回インストール時の切り替えでは再読み込みしない）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      // sw.js 自体はブラウザのHTTPキャッシュを使わずに毎回確認する（古い版が残り続けないように）
      // 公開先のパスの下にある sw.js を登録する（GitHub Pages では /<リポジトリ名>/sw.js）
      const base = import.meta.env.BASE_URL;
      const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' });

      const watch = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // すでに別の版で動いている場合だけ「更新あり」。初めてのインストールは案内しない
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setAvailable(worker);
        });
      };
      if (registration.waiting && navigator.serviceWorker.controller) setAvailable(registration.waiting);
      watch(registration.installing);
      registration.addEventListener('updatefound', () => watch(registration.installing));

      // ホーム画面から開いたアプリは長時間開いたままになりやすいので、戻ってきたときに更新を確認する
      let lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastCheck > UPDATE_CHECK_INTERVAL_MS) {
          lastCheck = Date.now();
          registration.update().catch(() => {});
        }
      });
    } catch {
      // 登録に失敗してもアプリはそのまま使える（オフライン起動ができないだけ）
    }
  });
}

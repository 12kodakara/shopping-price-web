/* 買い物価格比較 Service Worker
 *
 * このファイルは雛形。ビルド時（vite.config.ts の pwaPlugin）に
 * 公開先のパス・版番号・キャッシュするファイルの一覧を埋め込み、dist/sw.js として出力する。
 * 公開先のパスは、通常は '/'、GitHub Pages では '/<リポジトリ名>/'。
 *
 * 役割はアプリ本体（HTML・JS・CSS・アイコン）をキャッシュして、通信がなくても起動できるようにすることだけ。
 * 商品・店舗・価格履歴などのデータは今までどおり localStorage にあり、ここでは一切扱わない。
 *
 * キャッシュ方針:
 *   ・画面（ページの読み込み）… 通信を優先。つながらない・遅い（4秒）ときだけキャッシュの index.html を使う
 *     → オンラインなら常に最新版が表示される
 *   ・assets/ 以下 … ファイル名に内容のハッシュが入っていて中身が変わらないので、キャッシュを優先
 *   ・アイコン・manifest … キャッシュを優先（なければ通信）
 *
 * 更新方針:
 *   ・新しい版を見つけたら裏で準備（install）するが、自動では切り替えない（skipWaiting しない）
 *   ・画面に「新しいバージョンがあります」を出し、利用者が「更新する」を押したときだけ切り替えて再読み込みする
 *   ・切り替え時に古い版のキャッシュを削除する
 */

const BASE = '__BASE__';
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE_PREFIX = 'shopping-price-web-';
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// 画面の「更新する」から呼ばれる
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname.startsWith(`${BASE}assets/`) || PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirstPage(request) {
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS)),
    ]);
    if (response.ok) return response;
    throw new Error(`status ${response.status}`);
  } catch {
    // どのURL（/products など）でも同じ index.html を返し、画面の切り替えはアプリ側で行う
    const cached = await caches.match(`${BASE}index.html`, { cacheName: CACHE, ignoreVary: true });
    if (cached) return cached;
    return fetch(request);
  }
}

async function cacheFirst(request) {
  // ignoreVary: サーバーが「Vary: Origin」などを付けていても照合できるようにする
  // （JS はブラウザが Origin 付きで取りに来るため、キャッシュしたときと条件が変わる。中身は同じなので無視してよい）
  const cached = await caches.match(request, { cacheName: CACHE, ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

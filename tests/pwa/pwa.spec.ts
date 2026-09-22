import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { largeData } from '../fixtures/largeData';
import { choose } from '../fixtures/combobox';

// 第7回: PWA（manifest・アイコン・Service Worker・オフライン起動・更新・画面端の余白）
// 本番ビルドを vite preview（http://localhost:4173）で配信して確認する。
// Playwright はテストごとに新しいブラウザ環境を作るので、Service Worker もキャッシュも毎回まっさらな状態から始まる。

const KEY = 'shopping-price-web/v1';

const saved = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

/** PNG の幅・高さ（ファイル先頭の IHDR から読む） */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Service Worker が有効になり、このページを制御するまで待つ */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Service Worker の有効化の途中で読み込まれたページは、次に開くまで管理下に入らないことがある（ブラウザの仕様）。
  // 実際の利用と同じく、そのときは開き直してから確認する。
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** 第6回までの保存データ（買い物リスト・購入済みあり）を用意する */
async function seedExistingData(page: Page) {
  const data = largeData({ products: 60, stores: 12, records: 300 });
  data.shoppingList = ['P001', 'P002', 'P003'];
  data.purchased = ['P002'];
  const json = JSON.stringify(data);
  await page.goto('/');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, json] as const);
  return json;
}

test.describe('manifest・アイコン', () => {
  test('manifest を読み込み、必要な項目がそろっている', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m).toMatchObject({
      name: '買い物価格比較',
      short_name: '買い物価格比較',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f4f6f5',
      theme_color: '#1f6f5c',
      lang: 'ja',
    });
    // アプリ内の表記と同じ名前（新しいサービス名は付けていない）
    await expect(page).toHaveTitle(/買い物価格比較/);
    expect(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`).sort()).toEqual([
      '192x192:any',
      '192x192:maskable',
      '512x512:any',
      '512x512:maskable',
    ]);
  });

  test('192px・512px（maskable を含む）と iPhone 用アイコンが正しい大きさで配信される', async ({ request }) => {
    const expected: [string, number][] = [
      ['/icons/icon-192.png', 192],
      ['/icons/icon-512.png', 512],
      ['/icons/icon-maskable-192.png', 192],
      ['/icons/icon-maskable-512.png', 512],
      ['/icons/apple-touch-icon.png', 180],
    ];
    for (const [url, size] of expected) {
      const res = await request.get(url);
      expect(res.ok(), url).toBe(true);
      expect(res.headers()['content-type']).toContain('image/png');
      expect(pngSize(await res.body())).toEqual({ width: size, height: size });
    }
  });

  test('iPhone 用の設定（ホーム画面に追加したときのアイコン・名前）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', '買い物価格比較');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  });
});

test.describe('ビルド成果物', () => {
  test('dist に sw.js・manifest・アイコンがあり、sw.js はビルドした全ファイルをキャッシュ対象にしている', async () => {
    for (const f of ['dist/index.html', 'dist/sw.js', 'dist/manifest.webmanifest', 'dist/icons/icon-192.png', 'dist/icons/icon-512.png']) {
      expect(existsSync(f), f).toBe(true);
    }
    const sw = readFileSync('dist/sw.js', 'utf-8');
    expect(sw).toMatch(/const VERSION = '[0-9a-f]{12}';/);
    const precache: string[] = JSON.parse(sw.match(/const PRECACHE = (\[.*\]);/)![1]);
    expect(precache).toContain('/index.html');
    expect(precache).toContain('/manifest.webmanifest');
    for (const f of readdirSync('dist/assets')) expect(precache).toContain(`/assets/${f}`);
    for (const f of readdirSync('dist/icons')) expect(precache).toContain(`/icons/${f}`);
  });
});

test.describe('Service Worker', () => {
  test('本番ビルドでは登録され、アプリ本体をキャッシュする', async ({ page }) => {
    await page.goto('/');
    await waitForServiceWorker(page);
    const info = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      const cache = await caches.open(keys.find((k) => k.startsWith('shopping-price-web-'))!);
      const urls = (await cache.keys()).map((r) => new URL(r.url).pathname);
      return { script: reg?.active?.scriptURL, scope: reg?.scope, keys, urls };
    });
    expect(info.script).toBe('http://localhost:4173/sw.js');
    expect(info.scope).toBe('http://localhost:4173/');
    expect(info.keys).toHaveLength(1);
    expect(info.urls).toEqual(expect.arrayContaining(['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png']));
    expect(info.urls.some((u) => u.startsWith('/assets/') && u.endsWith('.js'))).toBe(true);
    // 初めてのインストールでは「新しいバージョン」の案内は出さない
    await expect(page.getByTestId('update-notice')).toHaveCount(0);
  });

  test('開発サーバー（npm run dev）では登録しない', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await page.waitForTimeout(500);
    const count = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    expect(count).toBe(0);
  });
});

test.describe('オフライン起動と既存データ', () => {
  test('PWA化前の保存データがそのまま読め、一度読み込んだ後は通信なしで各画面が使える', async ({ page, context }) => {
    const before = await seedExistingData(page);
    await page.reload();
    await waitForServiceWorker(page);
    expect(await saved(page)).toBe(before); // Service Worker の登録で保存データは変わらない

    await context.setOffline(true);
    // 通信なしで再読み込み・直接URLを開いても起動する（Service Worker のキャッシュから）
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await expect(page.getByTestId('stat-products')).toContainText('60');
    expect(await saved(page)).toBe(before);

    await page.goto('/products');
    await expect(page.getByTestId('product-list').locator('> li')).toHaveCount(50);
    await expect(page.getByTestId('product-count')).toHaveText('全60件中 1〜50件');
    await page.getByRole('navigation', { name: 'ページ' }).getByRole('button', { name: /次へ/ }).click();
    await expect(page.getByTestId('product-list').locator('> li')).toHaveCount(10);
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('牛乳');
    await expect(page.getByTestId('product-count')).toHaveText('6 / 60件');

    await page.goto('/stores');
    await expect(page.getByTestId('store-count')).toHaveText('12件');

    await page.goto('/compare');
    await expect(page.getByTestId('compare-cards')).toBeVisible();

    await page.goto('/history?product=all');
    await expect(page.getByTestId('record-count')).toHaveText('全300件中 1〜50件');

    // 買い物候補: 既存の購入済み状態が残っていて、チェックもできる
    await page.goto('/shopping');
    await expect(page.getByTestId('shopping-progress')).toContainText('1 / 3');
    await page.getByTestId('list-item-P001').getByRole('checkbox').check();
    await expect(page.getByTestId('shopping-progress')).toContainText('2 / 3');

    // 価格登録も通信なしで保存できる（保存先は端末の localStorage）
    await page.goto('/prices/new');
    await choose(page, 'product', 'P003');
    await choose(page, 'store', 'S001');
    await page.locator('#quantity').fill('2');
    await page.locator('#price').fill('250');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
    const after = JSON.parse((await saved(page))!);
    expect(after.priceRecords).toHaveLength(301);
    expect(after.purchased).toEqual(['P001', 'P002']);
    expect(after.version).toBe(1);
  });

  test('通信なしでもバックアップの保存・復元ができる', async ({ page, context }) => {
    const before = await seedExistingData(page);
    await page.reload();
    await waitForServiceWorker(page);
    await context.setOffline(true);

    await page.goto('/settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
    const text = readFileSync(await download.path(), 'utf-8');
    const json = JSON.parse(text);
    expect(json.version).toBe(1);
    expect(json.priceRecords).toHaveLength(300);
    expect(json.purchased).toEqual(['P002']);

    // いったんサンプルデータに戻してから、バックアップで復元
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'サンプルデータに戻す' }).click();
    await page.locator('#restore-file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この内容で復元する' }).click();
    await expect(page.getByRole('status')).toContainText('バックアップから復元しました');
    expect(JSON.parse((await saved(page))!)).toEqual(JSON.parse(before));
  });
});

test.describe('更新', () => {
  test('新しい版は自動で切り替えず、案内を出し、「更新する」を押したときだけ再読み込みする', async ({ page }) => {
    const before = await seedExistingData(page);
    await page.reload();
    await waitForServiceWorker(page);
    const original = readFileSync('dist/sw.js', 'utf-8');
    const oldVersion = original.match(/const VERSION = '([0-9a-f]+)'/)![1];

    // 公開先に新しい版をアップロードした状態を再現する: 配信中の dist/sw.js の版番号だけを書き換える
    // （Playwright の通信の差し替えは Service Worker 本体の取得には効かないため。長さは同じにしておく）
    const newVersion = 'next00000000';
    expect(newVersion).toHaveLength(oldVersion.length);
    writeFileSync('dist/sw.js', original.replace(`const VERSION = '${oldVersion}'`, `const VERSION = '${newVersion}'`));
    try {

    // 入力途中の状態を作る
    await page.goto('/prices/new');
    await page.locator('#price').fill('1234');
    let navigations = 0;
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) navigations++;
    });

    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.getByTestId('update-notice')).toContainText('新しいバージョンがあります');
    // 勝手に再読み込みしない（入力中の内容が残っている）
    await page.waitForTimeout(1500);
    expect(navigations).toBe(0);
    await expect(page.locator('#price')).toHaveValue('1234');

    // 「更新する」を押すと切り替わって再読み込み
    await Promise.all([page.waitForEvent('framenavigated'), page.getByRole('button', { name: '更新する' }).click()]);
    await expect(page.getByRole('heading', { level: 1, name: '価格登録' })).toBeVisible();
    await expect(page.getByTestId('update-notice')).toHaveCount(0);
    const keys = await page.evaluate(() => caches.keys());
    expect(keys).toEqual([`shopping-price-web-${newVersion}`]); // 古い版のキャッシュは削除
    expect(await saved(page)).toBe(before); // データはそのまま
    } finally {
      writeFileSync('dist/sw.js', original);
    }
  });
});

test.describe('ホーム画面のアプリ相当の表示（画面端の余白）', () => {
  /** iPhone（ノッチ・ホームインジケータあり）の余白を再現する */
  async function simulateIphoneInsets(page: Page) {
    await page.addStyleTag({ content: ':root { --safe-top: 47px; --safe-bottom: 34px; }' });
  }

  test('上端・下端の余白を考慮し、ヘッダー・下部ナビ・進捗欄・ダイアログが隠れない', async ({ page }) => {
    const data = largeData({ products: 30, stores: 5, records: 200 });
    data.shoppingList = data.products.slice(0, 20).map((p) => p.id);
    data.purchased = ['P001', 'P003'];
    await page.goto('/');
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify(data)] as const);
    await page.goto('/shopping');
    await simulateIphoneInsets(page);
    const vh = page.viewportSize()!.height;

    // 上端: タイトルとメニューボタンはノッチ（47px）より下
    const title = await page.locator('.topbar-title').boundingBox();
    expect(title!.y).toBeGreaterThanOrEqual(47);
    const menuButton = await page.getByRole('button', { name: 'メニューを開く' }).boundingBox();
    expect(menuButton!.y).toBeGreaterThanOrEqual(47);

    // 下端: 下部ナビのボタンはホームインジケータ（34px）より上
    for (const link of await page.getByTestId('bottom-nav').getByRole('link').all()) {
      const b = await link.boundingBox();
      expect(b!.y + b!.height).toBeLessThanOrEqual(vh - 34 + 1);
    }

    // スクロールしても、進捗欄はヘッダーのすぐ下に残る（ヘッダーに隠れない）
    await page.evaluate(() => window.scrollTo(0, 500));
    const header = await page.locator('.topbar').boundingBox();
    const toolbar = await page.locator('.list-toolbar').boundingBox();
    expect(toolbar!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
    await expect(page.getByTestId('shopping-progress')).toBeInViewport();

    // いちばん下の行は下部ナビより上まで来る
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const nav = await page.getByTestId('bottom-nav').boundingBox();
    const lastRow = await page.locator('.check-item').last().boundingBox();
    const listEnd = await page.getByTestId('shopping-list').boundingBox();
    expect(Math.min(lastRow!.y + lastRow!.height, listEnd!.y + listEnd!.height)).toBeLessThanOrEqual(nav!.y);

    // 確認ダイアログは画面内（余白の内側）に収まり、ボタンが押せる
    await page.getByRole('button', { name: 'すべて未購入に戻す' }).click();
    const dialog = await page.getByRole('alertdialog').boundingBox();
    expect(dialog!.y).toBeGreaterThanOrEqual(47);
    expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(vh - 34);
    await page.getByRole('alertdialog').getByRole('button', { name: 'キャンセル' }).click();

    // メニューの見出しもノッチより下
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    const sheetHead = await page.locator('.menu-sheet-head').boundingBox();
    expect(sheetHead!.y).toBeGreaterThanOrEqual(47);

    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
  });

  test('余白のない端末（Android など）では、これまでと同じ位置', async ({ page }) => {
    await page.goto('/shopping');
    const title = await page.locator('.topbar').boundingBox();
    expect(title!.y).toBe(0);
    expect(title!.height).toBe(52);
    const nav = await page.getByTestId('bottom-nav').boundingBox();
    expect(nav!.height).toBe(64);
    expect(nav!.y + nav!.height).toBe(page.viewportSize()!.height);
  });

  test('ホーム画面から開いたときは、データ管理に「ホーム画面のアプリ」と表示する', async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => (q === '(display-mode: standalone)' ? ({ ...original(q), matches: true } as MediaQueryList) : original(q));
    });
    await page.goto('/settings');
    await expect(page.getByTestId('display-mode')).toHaveText('ホーム画面のアプリ');
    await expect(page.getByTestId('device-storage')).toContainText('iPhone では、Safari で開いたときと');
  });

  test('ブラウザで開いたときは「ブラウザ」と表示する', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('display-mode')).toHaveText('ブラウザ');
  });
});

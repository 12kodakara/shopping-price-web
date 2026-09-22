import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { largeData } from '../fixtures/largeData';
import { choose } from '../fixtures/combobox';

// 第8回: GitHub Pages のように、サイトの一番上ではなく /<リポジトリ名>/ の下で配信したときの確認。
//   ・ローカル: npm run build:pages → npm run preview:pages（http://localhost:4373/shopping-price-web/）
//   ・公開後:   npm run verify:deploy（公開URLに対して同じテストを実行。playwright.deploy.config.ts）
// Playwright はテストごとに新しいブラウザ環境を作るので、ここでの復元などは利用者の端末のデータには影響しない。

const BASE = process.env.PAGES_BASE ?? '/shopping-price-web/';
const DEPLOYED = !!process.env.DEPLOY_URL;
const KEY = 'shopping-price-web/v1';

const saved = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Service Worker の有効化の途中で読み込まれたページは、次に開くまで管理下に入らないことがある（ブラウザの仕様）。
  // 実際の利用と同じく、そのときは開き直してから確認する。
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test.describe('公開先のパスでの表示', () => {
  test('トップ画面が表示され、検索エンジンに載せない設定がある', async ({ page }) => {
    // コンソールの重大なエラー（読み込み失敗・実行時エラー）がないことも確認する
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    const res = await page.goto(BASE);
    expect(res!.status()).toBe(200);
    if (DEPLOYED) expect(page.url()).toMatch(/^https:\/\//);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `${BASE}manifest.webmanifest`);
    // JS・CSS も公開先のパスから読み込まれている
    const assets = await page.evaluate(() => [...document.querySelectorAll('script[src], link[rel="stylesheet"]')].map((e) => e.getAttribute('src') ?? e.getAttribute('href')));
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const a of assets) expect(a!.startsWith(`${BASE}assets/`)).toBe(true);
    // 画面を一通り開いてもエラーが出ない
    for (const path of ['products', 'stores', 'prices/new', 'compare', 'shopping', 'history', 'settings']) {
      await page.goto(`${BASE}${path}`);
      await expect(page.locator('h1')).toBeVisible();
    }
    // 直接開いた画面は GitHub Pages が 404 で返すため、その読み込み自体の記録は除く（アプリは表示される）
    expect(errors.filter((e) => !/status of 404/.test(e))).toEqual([]);
  });

  test('下部ナビ・メニューでの移動が公開先のパスの下になる', async ({ page }) => {
    await page.goto(BASE);
    const nav = page.getByTestId('bottom-nav');
    const pages: [string, string, string][] = [
      ['商品', 'products', '商品'],
      ['価格登録', 'prices/new', '価格登録'],
      ['価格比較', 'compare', '価格比較'],
      ['買い物候補', 'shopping', '買い物候補'],
      ['ホーム', '', 'ホーム'],
    ];
    for (const [label, path, heading] of pages) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${BASE.replaceAll('/', '\\/')}${path.replace('/', '\\/')}$`));
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    for (const [label, path] of [['価格履歴', 'history'], ['店舗', 'stores'], ['データ管理', 'settings']]) {
      await page.getByRole('button', { name: 'メニューを開く' }).click();
      await page.getByRole('dialog').getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });

  test('末尾の / がないURL（/<リポジトリ名>）で開いても、/ 付きになって表示される', async ({ page }) => {
    // ローカルの vite preview は /<リポジトリ名> を 404 にする（GitHub Pages は / 付きへ転送する）ので、公開後だけ確認する
    test.skip(!DEPLOYED, '公開先（GitHub Pages）でのみ確認');
    await page.goto(BASE.slice(0, -1));
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(BASE);
  });

  test('各画面のURLを直接開いても表示される（再読み込み・ブックマーク）', async ({ page }) => {
    for (const [path, heading] of [
      ['products', '商品'],
      ['stores', '店舗'],
      ['prices/new', '価格登録'],
      ['compare', '価格比較'],
      ['shopping', '買い物候補'],
      ['history?product=all', '価格履歴'],
      ['settings', 'データ管理'],
    ]) {
      const res = await page.goto(`${BASE}${path}`);
      // GitHub Pages は 404.html（中身は index.html と同じ）を 404 で返すが、アプリは表示される
      expect([200, 404]).toContain(res!.status());
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
  });
});

test.describe('PWA（公開先のパス）', () => {
  test('manifest の start_url・scope・アイコンが公開先のパスを指し、アイコンが取得できる', async ({ page, request }) => {
    await page.goto(BASE);
    const res = await request.get(`${BASE}manifest.webmanifest`);
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ name: '買い物価格比較', display: 'standalone', start_url: BASE, scope: BASE, id: BASE });
    for (const icon of m.icons as { src: string; sizes: string }[]) {
      expect(icon.src.startsWith(`${BASE}icons/`)).toBe(true);
      const r = await request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      const size = Number(icon.sizes.split('x')[0]);
      expect(pngSize(await r.body())).toEqual({ width: size, height: size });
    }
    const apple = await request.get(`${BASE}icons/apple-touch-icon.png`);
    expect(apple.status()).toBe(200);
  });

  test('Service Worker が公開先のパスで登録され、アプリ本体をキャッシュする', async ({ page }) => {
    await page.goto(BASE);
    await waitForServiceWorker(page);
    const info = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      const cache = await caches.open(keys.find((k) => k.startsWith('shopping-price-web-'))!);
      return { script: reg?.active?.scriptURL, scope: reg?.scope, urls: (await cache.keys()).map((r) => new URL(r.url).pathname) };
    });
    const origin = new URL(page.url()).origin;
    expect(info.script).toBe(`${origin}${BASE}sw.js`);
    expect(info.scope).toBe(`${origin}${BASE}`);
    expect(info.urls).toEqual(expect.arrayContaining([BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, `${BASE}icons/icon-512.png`]));
    expect(info.urls.some((u) => u.startsWith(`${BASE}assets/`) && u.endsWith('.js'))).toBe(true);
  });

  test('一度開いた後は、通信なしで起動し、各画面を直接開ける', async ({ page, context }) => {
    await page.goto(BASE);
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    for (const [path, heading] of [['shopping', '買い物候補'], ['history?product=all', '価格履歴'], ['products', '商品']]) {
      await page.goto(`${BASE}${path}`);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    // 通信なしでも価格登録できる（保存先は端末の localStorage）
    await page.goto(`${BASE}prices/new`);
    await choose(page, 'product', 'P005');
    await choose(page, 'store', 'S009');
    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('810');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
  });
});

test.describe('初めて開いたとき・データの移し方', () => {
  test('初めて開くとサンプルデータで起動する（保存データがない状態から）', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByTestId('stat-products')).toContainText('5');
    const data = JSON.parse((await saved(page))!);
    expect(data.version).toBe(1);
    expect(data.products.map((p: { id: string }) => p.id)).toEqual(['P001', 'P002', 'P003', 'P004', 'P005']);
  });

  test('JSONバックアップから復元すると、商品・店舗・価格履歴・買い物候補がそろう', async ({ page }) => {
    // 別の場所（例: 開発用のアドレス）で作ったバックアップを想定
    const source = largeData({ products: 60, stores: 8, records: 250 });
    source.shoppingList = ['P001', 'P002', 'P011'];
    source.purchased = ['P002'];
    const backup = JSON.stringify({ app: 'shopping-price-web', exportedAt: '2026-09-22T00:00:00.000Z', ...source }, null, 2);

    await page.goto(`${BASE}settings`);
    await page.locator('#restore-file').setInputFiles({ name: 'shopping-price-backup-2026-09-22.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await expect(page.getByTestId('restore-preview').getByTestId('summary-products')).toContainText('60件');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この内容で復元する' }).click();
    await expect(page.getByRole('status')).toContainText('バックアップから復元しました');

    const { app: _a, exportedAt: _e, ...expected } = JSON.parse(backup);
    expect(JSON.parse((await saved(page))!)).toEqual(expected);

    await page.goto(`${BASE}products`);
    await expect(page.getByTestId('product-count')).toHaveText('全60件中 1〜50件');
    await page.goto(`${BASE}stores`);
    await expect(page.getByTestId('store-count')).toHaveText('8件');
    await page.goto(`${BASE}history?product=all`);
    await expect(page.getByTestId('record-count')).toHaveText('全250件中 1〜50件');
    await page.goto(`${BASE}shopping`);
    await expect(page.getByTestId('shopping-progress')).toContainText('1 / 3');

    // バックアップの保存もできる
    await page.goto(`${BASE}settings`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
    const json = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    expect(json.version).toBe(1);
    expect(json.priceRecords).toHaveLength(250);
  });

  test('検索・絞り込み・ページ分割が公開先のパスでも動く（テスト専用データ）', async ({ page }) => {
    const data = largeData({ products: 120, stores: 60, records: 400, archivedProductRatio: 0.1 });
    await page.goto(BASE);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify(data)] as const);

    // 商品: ページ分割 → 検索で1ページ目に戻る → 使用停止の切り替え
    await page.goto(`${BASE}products`);
    await expect(page.getByTestId('product-count')).toHaveText('全108件中 1〜50件');
    await page.getByRole('navigation', { name: 'ページ' }).getByRole('button', { name: /次へ/ }).click();
    await expect(page.locator('.pager-status')).toHaveText('2 / 3ページ');
    // 期待する件数はテスト用データから数える
    const active = data.products.filter((p) => !p.archived);
    const archived = data.products.filter((p) => p.archived);
    const milk = (list: { name: string }[]) => list.filter((p) => p.name.includes('牛乳')).length;
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('牛乳');
    await expect(page.getByTestId('product-count')).toHaveText(`${milk(active)} / ${active.length}件`);
    await expect(page.locator('.pager-status')).toHaveCount(0); // 1ページに収まる → ページ操作なし（1ページ目）
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('');
    await page.getByRole('radio', { name: '使用停止' }).check();
    await expect(page.getByTestId('product-count')).toHaveText(`${archived.length}件`);
    await page.getByRole('button', { name: 'クリア', exact: true }).click();
    await expect(page.getByTestId('product-count')).toHaveText('全108件中 1〜50件');

    // 店舗: 検索
    await page.goto(`${BASE}stores`);
    await expect(page.getByTestId('store-count')).toHaveText('全60件中 1〜50件');
    await page.getByRole('searchbox', { name: '店舗を検索' }).fill('テスト店 05');
    const stores05 = data.stores.filter((st) => st.name.includes('05')).length;
    await expect(page.getByTestId('store-count')).toHaveText(`${stores05} / 60件`);

    // 価格履歴: 期間での絞り込み・ページ分割
    await page.goto(`${BASE}history?product=all`);
    await expect(page.getByTestId('record-count')).toHaveText('全400件中 1〜50件');
    await page.getByLabel('開始日').fill('2026-01-01');
    await page.getByLabel('終了日').fill('2026-03-31');
    await expect(page.getByTestId('record-count')).toContainText(' / 400件');
    const dates = await page.getByTestId('history-list').locator('.muted.small').allInnerTexts();
    expect(dates.filter((t) => /^\d+\/\d+ /.test(t)).every((t) => /^[1-3]\//.test(t))).toBe(true);

    // テストデータを残さない（このテスト用のブラウザ環境の中だけだが、念のため消す）
    await page.evaluate((key) => localStorage.removeItem(key), KEY);
  });

  test('アドレス（origin）が違えばデータも別（自動では移らない）', async ({ page }) => {
    test.skip(DEPLOYED, 'ローカルの2つのアドレスで確認する');
    // 別のアドレス（http://localhost:4173）に保存したデータは、公開先相当のアドレスからは見えない
    await page.goto('http://localhost:4173/');
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ marker: 'other-origin' })), KEY);
    await page.goto(BASE);
    const here = await saved(page);
    expect(here).not.toContain('other-origin');
    await page.goto('http://localhost:4173/');
    expect(await saved(page)).toContain('other-origin');
  });
});

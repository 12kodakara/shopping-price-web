import { expect, test } from '@playwright/test';

// 実設定（.env.local）での確認。メール送信は行わない。
const KEY = 'shopping-price-web/v1';

test('実設定でもアプリは通常どおり動き、起動時にクラウドへ通信しない', async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') external.push(new URL(r.url()).pathname);
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
  const before = await page.evaluate((k) => localStorage.getItem(k), KEY);

  for (const [path, heading] of [
    ['/products', '商品'],
    ['/prices/new', '価格登録'],
    ['/compare', '価格比較'],
    ['/shopping', '買い物候補'],
    ['/history', '価格履歴'],
    ['/stores', '店舗'],
    ['/settings', 'データ管理'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }

  // 未ログインの状態で、ログイン欄が出ている（＝実設定が読めている）
  await expect(page.getByLabel('メールアドレス')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログイン用のリンクを送る' })).toBeVisible();

  // 起動・画面移動だけでは、外部へ一切通信しない（データ送信なし）
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  // 保存データは変わらない
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(before);
});

test('既存データ（商品・価格履歴・買い物リスト）はそのまま使える', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k)!);
    d.shoppingList = ['P005'];
    d.purchased = [];
    localStorage.setItem(k, JSON.stringify(d));
  }, KEY);
  await page.goto('/shopping');
  await expect(page.getByTestId('shopping-progress')).toContainText('0 / 1');
  await page.getByTestId('list-item-P005').getByRole('checkbox').check();
  await expect(page.getByTestId('shopping-progress')).toContainText('1 / 1');
  await page.goto('/compare');
  await expect(page.getByTestId('compare-card-P005')).toContainText('140');
  await page.goto('/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^shopping-price-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

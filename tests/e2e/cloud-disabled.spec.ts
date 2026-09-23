import { expect, test, type Page } from '@playwright/test';

// 第11回: クラウド同期を設定していない状態（現在の公開版と同じ状態）。
// 認証まわりを追加しても、これまでどおり localStorage だけで動くことを確認する。

const KEY = 'shopping-price-web/v1';

/** 外部（このアプリの配信元以外）への通信を記録する */
function watchExternalRequests(page: Page) {
  const external: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(r.url());
  });
  return external;
}

test.describe('クラウド未設定のとき', () => {
  test('データ管理に「未設定」の案内が出て、ログイン欄は出ない', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('cloud-sync')).toContainText('アカウント・クラウド同期');
    await expect(page.getByTestId('cloud-status')).toContainText('クラウド同期はまだ設定されていません');
    await expect(page.getByLabel('メールアドレス')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ログイン用のリンクを送る' })).toHaveCount(0);
    await expect(page.getByTestId('cloud-notice')).toHaveCount(0);
  });

  test('外部への通信は一切しない（Supabaseのライブラリも読み込まない）', async ({ page }) => {
    const external = watchExternalRequests(page);
    const scripts: string[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('.js')) scripts.push(r.url());
    });
    await page.goto('/settings');
    await page.goto('/');
    await page.waitForTimeout(500);
    expect(external).toEqual([]);
    expect(scripts.filter((s) => /supabase/i.test(s))).toEqual([]);
  });

  test('これまでどおり登録・保存ができ、警告ダイアログも出ない', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs++;
      d.dismiss();
    });
    await page.goto('/prices/new');
    await page.locator('#product').click();
    await page.locator('#product').fill('P005');
    await page.getByTestId('product-combobox').getByRole('option').first().click();
    await page.locator('#store').click();
    await page.locator('#store').fill('S009');
    await page.getByTestId('store-combobox').getByRole('option').first().click();
    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('830');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');

    const data = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
    expect(data.version).toBe(1);
    expect(data.priceRecords).toHaveLength(11);
    expect(dialogs).toBe(0);
  });
});

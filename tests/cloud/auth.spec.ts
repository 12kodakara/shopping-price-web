import { expect, test, type Page, type Route } from '@playwright/test';

// 第11回: クラウド（Supabase）のログイン。
// テスト専用のダミー設定（.env.cloudmock）で起動し、Supabase への通信はこのテストが差し替える。
// 本物のキー・本物のメールアドレスは使わない。データの送受信（同期）はまだ無いので、それも確認する。

const KEY = 'shopping-price-web/v1';
const EMAIL = 'test-user@example.com';
const USER_ID = '11111111-1111-1111-1111-111111111111';

interface MockOptions {
  /** ログイン用リンクの送信結果 */
  otp?: { status: number; body: unknown };
}

/** Supabase への通信を差し替える。呼ばれたリクエストの記録を返す */
async function mockSupabase(page: Page, options: MockOptions = {}) {
  const calls: { path: string; body: string }[] = [];
  await page.route('**/supabase-mock/**', async (route: Route) => {
    const url = new URL(route.request().url());
    calls.push({ path: url.pathname + url.search, body: route.request().postData() ?? '' });

    if (url.pathname.endsWith('/auth/v1/otp')) {
      const otp = options.otp ?? { status: 200, body: {} };
      await route.fulfill({ status: otp.status, contentType: 'application/json', body: JSON.stringify(otp.body) });
      return;
    }
    if (url.pathname.endsWith('/auth/v1/token')) {
      // メールのリンクから戻ったときの引き換え（PKCE）
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'dummy-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'dummy-refresh-token',
          user: {
            id: USER_ID,
            aud: 'authenticated',
            role: 'authenticated',
            email: EMAIL,
            email_confirmed_at: '2026-09-01T00:00:00Z',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            created_at: '2026-09-01T00:00:00Z',
          },
        }),
      });
      return;
    }
    if (url.pathname.endsWith('/auth/v1/logout')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return calls;
}

const section = (page: Page) => page.getByTestId('cloud-sync');

/** ログイン用リンクを送る（PKCE の検証用の値が端末に保存される） */
async function requestMagicLink(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByRole('button', { name: 'ログイン用のリンクを送る' }).click();
  await expect(page.getByTestId('cloud-sent')).toContainText('ログイン用のリンクを送りました');
}

/** メールのリンクを開いた状態（データ管理の画面へ ?code=... 付きで戻ってくる）。ログイン完了まで待つ */
async function openMagicLink(page: Page) {
  await page.goto('/settings?code=dummy-auth-code');
  await expect(page.getByRole('heading', { level: 1, name: 'データ管理' })).toBeVisible();
  await expect(page.getByTestId('cloud-account')).toContainText(EMAIL);
}

test.describe('クラウド同期が設定されているとき（ダミー設定）', () => {
  test('未ログインのときは、説明とメールアドレスの入力欄が出る', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/settings');
    await expect(section(page)).toContainText('アカウント・クラウド同期');
    await expect(page.getByTestId('cloud-status')).toContainText('ログインすると');
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ログイン用のリンクを送る' })).toBeVisible();
    // 画面上部に常時表示のログインUIは出さない（データ管理の中だけ）
    await page.goto('/');
    await expect(page.getByTestId('cloud-sync')).toHaveCount(0);
  });

  test('メールアドレスが空欄・形式不正なら送信しない', async ({ page }) => {
    const calls = await mockSupabase(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'ログイン用のリンクを送る' }).click();
    await expect(page.locator('#cloud-email-error')).toContainText('メールアドレスを入力してください');
    await page.getByLabel('メールアドレス').fill('abc');
    await page.getByRole('button', { name: 'ログイン用のリンクを送る' }).click();
    await expect(page.locator('#cloud-email-error')).toContainText('形式が正しくありません');
    expect(calls).toHaveLength(0);
  });

  test('ログイン用リンクを送ると、送信先とやり直しの案内が出る', async ({ page }) => {
    const calls = await mockSupabase(page);
    await requestMagicLink(page);
    await expect(page.getByTestId('cloud-sent')).toContainText(EMAIL);

    const otp = calls.filter((c) => c.path.includes('/auth/v1/otp'));
    expect(otp).toHaveLength(1);
    const body = JSON.parse(otp[0].body);
    expect(body.email).toBe(EMAIL);
    expect(String(body.code_challenge ?? '')).not.toBe(''); // PKCE（リンクの引き換え用）
    // 戻り先はデータ管理の画面（リクエストのURLに付く）
    expect(decodeURIComponent(otp[0].path)).toContain('redirect_to=http://localhost:5273/settings');

    await page.getByRole('button', { name: '別のメールアドレスで送る' }).click();
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
  });

  test('送信に失敗したら、その理由を表示する（入力はやり直せる）', async ({ page }) => {
    await mockSupabase(page, { otp: { status: 429, body: { msg: 'For security purposes, you can only request this after 60 seconds' } } });
    await page.goto('/settings');
    await page.getByLabel('メールアドレス').fill(EMAIL);
    await page.getByRole('button', { name: 'ログイン用のリンクを送る' }).click();
    await expect(page.locator('#cloud-email-error')).toContainText('メールを送信できませんでした');
    await expect(page.getByTestId('cloud-sent')).toHaveCount(0);
  });

  test('メールのリンクから戻るとログインでき、再読み込み後も保たれ、ログアウトできる', async ({ page }) => {
    await mockSupabase(page);
    const before = await page.evaluate(() => null);
    expect(before).toBeNull();

    await requestMagicLink(page);
    await openMagicLink(page);

    await expect(page.getByTestId('cloud-account')).toContainText(EMAIL);
    // URLに残った ?code= は消える（引き換えが終わった後に消えるので、消えるまで待つ）
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(page.getByTestId('cloud-notice')).toContainText('ログインしました');
    await expect(page.getByTestId('cloud-status')).toContainText('自動では送受信しません');

    // 再読み込みしてもログインは保たれる
    await page.reload();
    await expect(page.getByTestId('cloud-account')).toContainText(EMAIL);

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page.getByTestId('cloud-notice')).toContainText('ログアウトしました');
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('cloud-account')).toHaveCount(0);
  });

  test('リンクが期限切れなどで戻ってきたときは、その理由を表示する', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/settings?error=access_denied&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.getByTestId('cloud-notice')).toContainText('ログインできませんでした');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
  });

  test('ログインしてもデータは送受信しない（保存データはこの端末のまま）', async ({ page }) => {
    const calls = await mockSupabase(page);
    await page.goto('/');
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
    await requestMagicLink(page);
    await openMagicLink(page);
    await page.goto('/products');
    await page.goto('/shopping');
    await page.goto('/settings');
    await expect(page.getByTestId('cloud-account')).toContainText(EMAIL);
    await page.waitForTimeout(500); // 同期らしき通信が後から出ないことも確かめる

    // 保存データは変わらない
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
    // データベース（/rest/v1/）への通信は一度も発生していない
    expect(calls.filter((c) => c.path.includes('/rest/'))).toHaveLength(0);
    expect(calls.map((c) => c.path.split('?')[0].replace('/supabase-mock', ''))).toEqual(
      expect.arrayContaining(['/auth/v1/otp', '/auth/v1/token']),
    );
  });

  test('通信できないときも、アプリは今までどおり使える', async ({ page, context }) => {
    // このテストでは通信の差し替えをしない（実際に届かない状態にする）
    // 開発用サーバーには Service Worker がないので、先に画面を開いてから通信を切る
    // （本番のオフライン起動は tests/pwa 側で確認している）
    await page.goto('/settings');
    await context.setOffline(true);
    await page.getByLabel('メールアドレス').fill(EMAIL);
    await page.getByRole('button', { name: 'ログイン用のリンクを送る' }).click();
    await expect(page.locator('#cloud-email-error')).toContainText('通信できませんでした');

    // 通信がなくても、これまでの機能はそのまま使える（画面内の移動で確認）
    await page.getByTestId('bottom-nav').getByRole('link', { name: '価格登録' }).click();
    await page.locator('#product').click();
    await page.locator('#product').fill('P005');
    await page.getByTestId('product-combobox').getByRole('option').first().click();
    await page.locator('#store').click();
    await page.locator('#store').fill('S009');
    await page.getByTestId('store-combobox').getByRole('option').first().click();
    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('820');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
  });
});

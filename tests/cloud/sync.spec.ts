import { expect, test, type Page, type Route } from '@playwright/test';

// 第12回: クラウドとのデータのやりとり（手動・確認つき）。
// テスト専用のダミー設定（.env.cloudmock）で起動し、Supabase への通信はこのテストが差し替える。
// 本物のキー・本物のメールアドレス・本物のデータベースは使わない。

const KEY = 'shopping-price-web/v1';
const EMAIL = 'test-user@example.com';
const USER_ID = '11111111-1111-1111-1111-111111111111';

type Table = 'products' | 'stores' | 'price_records' | 'shopping_items' | 'user_settings';
type Row = Record<string, unknown>;
type Db = Record<Table, Row[]>;

const emptyDb = (): Db => ({ products: [], stores: [], price_records: [], shopping_items: [], user_settings: [] });

/** クラウドに置いておくデータ（この端末のサンプルとは別の内容） */
function cloudFixture(): Db {
  return {
    products: [
      {
        user_id: USER_ID,
        id: 'P001',
        category: '飲料',
        name: 'クラウドのお茶',
        unit_amount: 1,
        unit: '本',
        target_unit_price: 100,
        maker: null,
        memo: null,
        archived: false,
      },
      {
        user_id: USER_ID,
        id: 'P002',
        category: '食品',
        name: 'クラウドのパン',
        unit_amount: 1,
        unit: '個',
        target_unit_price: null,
        maker: null,
        memo: null,
        archived: false,
      },
    ],
    stores: [{ user_id: USER_ID, id: 'S001', name: 'クラウドの店', type: null, memo: null, archived: false }],
    price_records: [
      {
        user_id: USER_ID,
        id: 'R001',
        date: '2026-09-20',
        product_id: 'P001',
        store_id: 'S001',
        quantity: 6,
        price: 600,
        sale: false,
        note: null,
        seq: 1,
        recorded_at: '2026-09-20T12:00:00.000Z',
        record_updated_at: null,
      },
    ],
    shopping_items: [{ user_id: USER_ID, product_id: 'P002', purchased: false }],
    user_settings: [
      { user_id: USER_ID, data_version: 1, counter_product: 2, counter_store: 1, counter_record: 1, last_synced_at: '2026-09-25T01:23:00.000Z' },
    ],
  };
}

interface MockOptions {
  cloud?: Db;
  /** 保存（INSERT）を失敗させる */
  failInsert?: boolean;
}

interface Mock {
  db: Db;
  calls: { method: string; path: string; body: string }[];
}

/** Supabase（認証＋データベース）への通信を差し替える */
async function mockSupabase(page: Page, options: MockOptions = {}): Promise<Mock> {
  const db: Db = options.cloud ?? emptyDb();
  const calls: Mock['calls'] = [];

  await page.route('**/supabase-mock/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ?? '';
    calls.push({ method, path: url.pathname + url.search, body });

    // ---------- 認証 ----------
    if (url.pathname.endsWith('/auth/v1/otp')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.pathname.endsWith('/auth/v1/token')) {
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

    // ---------- データベース（PostgREST の動きを最小限まねる） ----------
    const match = url.pathname.match(/\/rest\/v1\/([a-z_]+)$/);
    if (match) {
      const table = match[1] as Table;
      const rows = db[table] ?? [];

      if (method === 'HEAD' || method === 'GET') {
        const filtered = url.searchParams.get('purchased') === 'eq.true' ? rows.filter((r) => r.purchased === true) : rows;
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-range': `*/${filtered.length}`,
            // 別オリジンからは content-range が既定で読めないため、読めるように明示する（本物の Supabase も同じ設定）
            'access-control-allow-origin': '*',
            'access-control-expose-headers': 'content-range',
          },
          body: method === 'HEAD' ? '' : JSON.stringify(filtered),
        });
        return;
      }
      if (method === 'POST') {
        if (options.failInsert) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'insert failed' }) });
          return;
        }
        const payload = JSON.parse(body || '[]');
        const incoming: Row[] = Array.isArray(payload) ? payload : [payload];
        // upsert（user_settings）は同じ user_id を置き換える
        const isUpsert = (request.headers()['prefer'] ?? '').includes('merge-duplicates');
        db[table] = isUpsert ? [...rows.filter((r) => !incoming.some((i) => i.user_id === r.user_id)), ...incoming] : [...rows, ...incoming];
        await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
        return;
      }
      if (method === 'DELETE') {
        db[table] = [];
        await route.fulfill({ status: 204, body: '' });
        return;
      }
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  return { db, calls };
}

/** この端末を「データなし」の状態にして開く */
async function startEmptyLocal(page: Page) {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [
      KEY,
      JSON.stringify({ version: 1, products: [], stores: [], priceRecords: [], shoppingList: [], purchased: [], counters: { product: 0, store: 0, record: 0 } }),
    ],
  );
}

/** ログインした状態にする（メールのリンクを開いたのと同じ流れ） */
async function signIn(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByRole('button', { name: 'ログイン用のリンクを送る' }).click();
  await expect(page.getByTestId('cloud-sent')).toBeVisible();
  await page.goto('/settings?code=dummy-auth-code');
  await expect(page.getByTestId('cloud-account')).toContainText(EMAIL);
}

const restCalls = (mock: Mock) => mock.calls.filter((c) => c.path.includes('/rest/v1/'));

test.describe('クラウドとのデータのやりとり', () => {
  test('ログインしただけでは通信せず、ボタンを押すと件数が表示される', async ({ page }) => {
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);

    // ログイン直後はデータベースへ一切アクセスしない
    expect(restCalls(mock)).toHaveLength(0);
    await expect(page.getByTestId('cloud-checked-at')).toContainText('まだ確認していません');
    await expect(page.getByTestId('cloud-counts')).toContainText('—');

    await page.getByTestId('cloud-check').click();
    const counts = page.getByTestId('cloud-counts');
    await expect(counts.getByRole('row', { name: /商品/ })).toContainText('2件');
    await expect(counts.getByRole('row', { name: /店舗/ })).toContainText('1件');
    await expect(counts.getByRole('row', { name: /価格履歴/ })).toContainText('1件');
    await expect(page.getByTestId('cloud-checked-at')).toContainText('クラウドの確認：');
    // クラウド側に記録されている最終保存日時も表示される
    await expect(page.getByTestId('cloud-updated-at')).toContainText('クラウドの最終保存：2026/9/25');
  });

  test('クラウドが空なら、この端末のデータをそのまま保存できる', async ({ page }) => {
    const mock = await mockSupabase(page);
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await page.getByTestId('cloud-upload').click();
    await expect(page.getByTestId('cloud-plan')).toContainText('クラウドは空です');
    // 上書きの確認は不要
    await expect(page.getByTestId('cloud-confirm')).toHaveCount(0);
    await page.getByTestId('cloud-run').click();
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');
    await expect(page.getByTestId('cloud-updated-at')).toContainText('クラウドの最終保存：');

    // クラウドに入った内容（サンプルデータ）
    expect(mock.db.products).toHaveLength(5);
    expect(mock.db.stores).toHaveLength(9);
    expect(mock.db.price_records).toHaveLength(10);
    expect(mock.db.user_settings).toHaveLength(1);
    // 送った行はすべてログイン中の利用者のもの（他人のIDは付けない）
    const allRows = [...mock.db.products, ...mock.db.stores, ...mock.db.price_records, ...mock.db.shopping_items, ...mock.db.user_settings];
    expect(new Set(allRows.map((r) => r.user_id))).toEqual(new Set([USER_ID]));
    // 端末のデータは変わらない
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
  });

  test('クラウドに別の内容があるときは、確認しないと保存できない', async ({ page }) => {
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);

    await page.getByTestId('cloud-upload').click();
    await expect(page.getByTestId('cloud-plan')).toContainText('クラウドに別の内容のデータがあります');
    await expect(page.getByTestId('cloud-run')).toBeDisabled();

    await page.getByTestId('cloud-confirm').check();
    await expect(page.getByTestId('cloud-run')).toBeEnabled();
    await page.getByTestId('cloud-run').click();
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');
    // 置き換わっている（クラウドの元データは残らない）
    expect(mock.db.products).toHaveLength(5);
    expect(mock.db.products.map((p) => p.name)).not.toContain('クラウドのお茶');
  });

  test('★この端末が空のときは保存できない（クラウドのデータを消さない）', async ({ page }) => {
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    await startEmptyLocal(page);
    await signIn(page);

    await page.getByTestId('cloud-upload').click();
    await expect(page.getByTestId('cloud-plan')).toContainText('この端末にデータがありません');
    await expect(page.getByTestId('cloud-run')).toBeDisabled();
    await page.getByTestId('cloud-cancel').click();

    // クラウドのデータはそのまま
    expect(mock.db.products).toHaveLength(2);
    expect(restCalls(mock).some((c) => c.method === 'DELETE')).toBe(false);
  });

  test('★クラウドが空のときは取得できない（この端末のデータを消さない）', async ({ page }) => {
    const mock = await mockSupabase(page);
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await page.getByTestId('cloud-download').click();
    await expect(page.getByTestId('cloud-plan')).toContainText('クラウドにデータがありません');
    await expect(page.getByTestId('cloud-run')).toBeDisabled();

    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
    expect(restCalls(mock).some((c) => c.method === 'DELETE')).toBe(false);
  });

  test('取得は、バックアップを保存して確認してから実行できる（元に戻せる）', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);

    await page.getByTestId('cloud-download').click();
    await expect(page.getByTestId('cloud-plan')).toContainText('この端末にも別の内容のデータがあります');
    await expect(page.getByTestId('cloud-preview')).toContainText('2026/9/25');

    // バックアップも確認もまだなので実行できない
    await expect(page.getByTestId('cloud-run')).toBeDisabled();
    await page.getByTestId('cloud-confirm').check();
    await expect(page.getByTestId('cloud-run')).toBeDisabled();

    const download = page.waitForEvent('download');
    await page.getByTestId('cloud-backup').click();
    expect((await download).suggestedFilename()).toMatch(/^shopping-price-backup-.*\.json$/);
    await expect(page.getByTestId('cloud-run')).toBeEnabled();

    await page.getByTestId('cloud-run').click();
    await expect(page.getByTestId('cloud-message')).toContainText('この端末へ取り込みました');

    // この端末のデータがクラウドの内容に置き換わった
    const stored = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? '{}');
    expect(stored.products.map((p: { name: string }) => p.name)).toEqual(['クラウドのお茶', 'クラウドのパン']);
    expect(stored.stores).toHaveLength(1);
    expect(stored.priceRecords).toHaveLength(1);
    expect(stored.shoppingList).toEqual(['P002']);
    expect(stored.version).toBe(1);

    // 画面にも反映され、「1つ前の状態に戻す」で元に戻せる
    await page.goto('/products');
    await expect(page.getByRole('main')).toContainText('クラウドのお茶');
    await page.goto('/settings');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: '1つ前の状態に戻す' }).click();
    await page.goto('/products');
    await expect(page.getByRole('main')).toContainText('サランラップ');
  });

  test('クラウドと内容を見比べて、同じなら確認なしで取得できる', async ({ page }) => {
    await mockSupabase(page);
    await signIn(page);
    // まず今の端末のデータをクラウドへ保存し、両者を同じ内容にする
    await page.getByTestId('cloud-upload').click();
    await page.getByTestId('cloud-run').click();
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');

    await page.getByTestId('cloud-download').click();
    await page.getByTestId('cloud-compare').click();
    await expect(page.getByTestId('cloud-message')).toContainText('内容は同じです');
    await expect(page.getByTestId('cloud-plan')).toContainText('同じです');
    await expect(page.getByTestId('cloud-confirm')).toHaveCount(0);
  });

  test('保存に失敗しても、この端末のデータは変わらない', async ({ page }) => {
    await mockSupabase(page, { failInsert: true });
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await page.getByTestId('cloud-upload').click();
    await page.getByTestId('cloud-run').click();
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存できませんでした');

    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
    // 画面は今までどおり使える
    await page.goto('/products');
    await expect(page.getByRole('main')).toContainText('サランラップ');
  });

  test('クラウド側の準備ができていないときは、その旨を知らせる', async ({ page }) => {
    await mockSupabase(page);
    await page.route('**/supabase-mock/rest/v1/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.products' in the schema cache" }),
      });
    });
    await signIn(page);
    await page.getByTestId('cloud-check').click();
    await expect(page.getByTestId('cloud-message')).toContainText('テーブルの作成');
  });

  test('ログアウトすると、やりとりの操作は表示されない（データはこの端末に残る）', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);
    await expect(page.getByTestId('cloud-data')).toBeVisible();

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page.getByTestId('cloud-data')).toHaveCount(0);
    await expect(page.getByTestId('cloud-upload')).toHaveCount(0);

    await page.goto('/products');
    await expect(page.getByRole('main')).toContainText('サランラップ');
  });

  test('未ログインではクラウドのデータに一切アクセスしない', async ({ page }) => {
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    await page.goto('/settings');
    await page.goto('/products');
    await page.goto('/shopping');
    await page.goto('/settings');
    await page.waitForTimeout(300);
    expect(restCalls(mock)).toHaveLength(0);
    await expect(page.getByTestId('cloud-data')).toHaveCount(0);
  });
});

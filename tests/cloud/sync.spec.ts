import { expect, test, type Page, type Route } from '@playwright/test';

// 第12回: クラウドとのデータのやりとり（手動・確認つき）。
// テスト専用のダミー設定（.env.cloudmock）で起動し、Supabase への通信はこのテストが差し替える。
// 本物のキー・本物のメールアドレス・本物のデータベースは使わない。

const KEY = 'shopping-price-web/v1';
/** 復元前バックアップ（「1つ前の状態に戻す」用）の保存先 */
const UNDO_KEY = 'shopping-price-web/v1/undo';
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

interface LocalData {
  version: number;
  products: { id: string; category: string; name: string; unitAmount: number; unit: string; targetUnitPrice: number | null; maker?: string; memo?: string; archived?: boolean }[];
  stores: { id: string; name: string; type?: string; memo?: string; archived?: boolean }[];
  priceRecords: { id: string; date: string; productId: string; storeId: string; quantity: number; price: number; sale?: boolean; note?: string; seq: number; createdAt: string; updatedAt?: string }[];
  counters: { product: number; store: number; record: number };
}

/** この端末の保存データと同じ内容をクラウドに置く（買い物リストだけは指定したものにする） */
function fillCloudFromLocal(mock: Mock, local: LocalData, shoppingList: string[], purchased: string[]) {
  mock.db.products = local.products.map((p) => ({
    user_id: USER_ID,
    id: p.id,
    category: p.category,
    name: p.name,
    unit_amount: p.unitAmount,
    unit: p.unit,
    target_unit_price: p.targetUnitPrice,
    maker: p.maker ?? null,
    memo: p.memo ?? null,
    archived: p.archived === true,
  }));
  mock.db.stores = local.stores.map((s) => ({ user_id: USER_ID, id: s.id, name: s.name, type: s.type ?? null, memo: s.memo ?? null, archived: s.archived === true }));
  mock.db.price_records = local.priceRecords.map((r) => ({
    user_id: USER_ID,
    id: r.id,
    date: r.date,
    product_id: r.productId,
    store_id: r.storeId,
    quantity: r.quantity,
    price: r.price,
    sale: r.sale === true,
    note: r.note ?? null,
    seq: r.seq,
    recorded_at: r.createdAt,
    record_updated_at: r.updatedAt ?? null,
  }));
  mock.db.shopping_items = shoppingList.map((id) => ({ user_id: USER_ID, product_id: id, purchased: purchased.includes(id) }));
  mock.db.user_settings = [
    {
      user_id: USER_ID,
      data_version: local.version,
      counter_product: local.counters.product,
      counter_store: local.counters.store,
      counter_record: local.counters.record,
      last_synced_at: '2026-09-28T01:00:00.000Z',
    },
  ];
}

interface MockOptions {
  cloud?: Db;
  /** 保存（INSERT）を失敗させる */
  failInsert?: boolean;
  /** 第16回: 指定した表への最初の保存（INSERT）だけを失敗させる（途中で失敗 → 書き戻しは成功、を再現） */
  failInsertOnce?: Table;
  /** 読み取り（件数・取得）を失敗させる。本文なしの応答も再現できる */
  failSelect?: { status: number; body?: unknown };
  /** 件数のヘッダー（content-range）を返さない */
  hideCountHeader?: boolean;
  /** 特定のテーブルの読み取りだけ失敗させる */
  failTable?: { table: Table; status: number; body?: unknown };
  /** ほかの利用者の行を混ぜて返す（本来 RLS で起こらないが、念のための確認） */
  foreignRows?: boolean;
}

interface Mock {
  db: Db;
  calls: { method: string; path: string; body: string }[];
}

/** Supabase（認証＋データベース）への通信を差し替える */
async function mockSupabase(page: Page, options: MockOptions = {}): Promise<Mock> {
  const db: Db = options.cloud ?? emptyDb();
  const calls: Mock['calls'] = [];
  const failedOnce = new Set<Table>();

  // 別オリジンへの通信なので、事前確認（OPTIONS）にも答えられるようにしておく
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'content-range,content-length',
  };

  await page.route('**/supabase-mock/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ?? '';
    calls.push({ method, path: url.pathname + url.search, body });

    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' });
      return;
    }

    // ---------- 認証 ----------
    if (url.pathname.endsWith('/auth/v1/otp')) {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{}' });
      return;
    }
    if (url.pathname.endsWith('/auth/v1/token')) {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
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
      await route.fulfill({ status: 204, headers: cors, body: '' });
      return;
    }

    // ---------- データベース（PostgREST の動きを最小限まねる） ----------
    const match = url.pathname.match(/\/rest\/v1\/([a-z_]+)$/);
    if (match) {
      const table = match[1] as Table;
      const rows = db[table] ?? [];

      if (method === 'HEAD' || method === 'GET') {
        // データ取得（select=*）だけを失敗させる。件数の取得（select=user_id）は成功させて、
        // 「プレビューまでは進めるが、取り込みの途中で失敗する」状況を作る
        if (options.failTable && options.failTable.table === table && url.searchParams.get('select') === '*') {
          await route.fulfill({
            status: options.failTable.status,
            headers: { ...cors, 'content-type': 'application/json' },
            body: options.failTable.body === undefined ? '' : JSON.stringify(options.failTable.body),
          });
          return;
        }
        if (options.failSelect) {
          await route.fulfill({
            status: options.failSelect.status,
            headers: { ...cors, 'content-type': 'application/json' },
            // 本文が空の応答（HEAD のときに起きていた状態）も再現する
            body: options.failSelect.body === undefined ? '' : JSON.stringify(options.failSelect.body),
          });
          return;
        }
        const withForeign =
          options.foreignRows && table === 'products'
            ? [...rows, { ...(rows[0] ?? {}), user_id: '99999999-9999-9999-9999-999999999999', id: 'P900', name: 'ほかの人の商品' }]
            : rows;
        const filtered = url.searchParams.get('purchased') === 'eq.true' ? withForeign.filter((r) => r.purchased === true) : withForeign;
        const limit = Number(url.searchParams.get('limit') ?? '');
        const body = Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered;
        await route.fulfill({
          status: 200,
          headers: {
            ...cors,
            'content-type': 'application/json',
            ...(options.hideCountHeader ? {} : { 'content-range': `*/${filtered.length}` }),
          },
          body: method === 'HEAD' ? '' : JSON.stringify(body),
        });
        return;
      }
      if (method === 'POST') {
        if (options.failInsert) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'insert failed' }) });
          return;
        }
        if (options.failInsertOnce === table && !failedOnce.has(table)) {
          failedOnce.add(table);
          await route.fulfill({ status: 500, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'insert failed' }) });
          return;
        }
        const payload = JSON.parse(body || '[]');
        const incoming: Row[] = Array.isArray(payload) ? payload : [payload];
        // upsert（user_settings）は同じ user_id を置き換える
        const isUpsert = (request.headers()['prefer'] ?? '').includes('merge-duplicates');
        db[table] = isUpsert ? [...rows.filter((r) => !incoming.some((i) => i.user_id === r.user_id)), ...incoming] : [...rows, ...incoming];
        await route.fulfill({ status: 201, headers: { ...cors, 'content-type': 'application/json' }, body: '[]' });
        return;
      }
      if (method === 'DELETE') {
        db[table] = [];
        await route.fulfill({ status: 204, headers: cors, body: '' });
        return;
      }
    }

    await route.fulfill({ status: 404, headers: { ...cors, 'content-type': 'application/json' }, body: '{}' });
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

/**
 * ログインした状態にする（メールのリンクを開いたのと同じ流れ）。
 * どの手順で止まったのかが分かるように、段階ごとに短い待ち時間と説明を付ける。
 */
async function signIn(page: Page) {
  const step = { at: '開始' };
  page.on('pageerror', (e) => console.log(`[画面の例外/${step.at}] ${String(e).slice(0, 200)}`));
  page.on('requestfailed', (r) => console.log(`[通信失敗/${step.at}] ${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ''}`));

  step.at = '画面を開く';
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'データ管理' }), 'データ管理の画面が表示されない').toBeVisible({ timeout: 15000 });

  step.at = 'ログイン欄の表示';
  await expect(page.getByLabel('メールアドレス'), 'ログイン欄が表示されない（クラウド設定が読めていない可能性）').toBeVisible({ timeout: 15000 });

  step.at = 'リンクの送信';
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByRole('button', { name: 'ログイン用のリンクを送る' }).click();
  await expect(page.getByTestId('cloud-sent'), '送信後の案内が出ない（認証の通信が返っていない可能性）').toBeVisible({ timeout: 15000 });

  step.at = 'リンクから戻る';
  await page.goto('/settings?code=dummy-auth-code');
  await expect(page.getByTestId('cloud-account'), 'ログイン状態にならない（引き換えの通信が返っていない可能性）').toContainText(EMAIL, {
    timeout: 15000,
  });
}

const restCalls = (mock: Mock) => mock.calls.filter((c) => c.path.includes('/rest/v1/'));

/** 「内容が置き換わることを理解しました」にチェックを入れる */
async function tickConfirm(page: Page) {
  const box = page.getByTestId('cloud-confirm');
  await box.waitFor({ state: 'visible' });
  await box.evaluate((node) => (node as HTMLInputElement).click());
  await expect(box).toBeChecked();
}

/**
 * クラウド操作のボタンを押す。
 * この欄は画面の下の方にあるため、先に画面内へ移動させてから押す
 * （環境によっては、押す直前の自動スクロールが終わらないことがあるため）。
 */
async function tap(page: Page, testId: string) {
  const button = page.getByTestId(testId);
  await button.waitFor({ state: 'visible' });
  await expect(button, `${testId} が押せる状態でない`).toBeEnabled();
  // 画面内への自動スクロールを待たずに、ブラウザの中で直接押す。
  // （実際の指でのタップ・マウス操作は「PC・スマホ」のテストで確認している）
  await button.evaluate((node) => (node as HTMLElement).click());
}

/**
 * 取り込み前のバックアップを保存する。
 * ファイル保存そのもの（ダウンロード完了の待ち受け）は環境差が出やすいので、ここでは画面の状態で確認する。
 * 実際にファイルが作られることは「取得は、確認してから実行できる」で確認している。
 */
async function saveBackup(page: Page) {
  await tap(page, 'cloud-backup');
  await expect(page.getByTestId('cloud-backup')).toContainText('バックアップを保存しました');
}

test.describe('クラウドとのデータのやりとり', () => {
  test('ログインしただけでは通信せず、ボタンを押すと件数が表示される', async ({ page }) => {
    const failures: string[] = [];
    page.on('requestfailed', (r) => failures.push(`失敗 ${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ''}`));
    page.on('pageerror', (e) => failures.push(`例外 ${String(e).slice(0, 120)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') failures.push(`コンソール ${m.text().slice(0, 120)}`);
    });
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);

    // ログイン直後はデータベースへ一切アクセスしない
    expect(restCalls(mock)).toHaveLength(0);
    await expect(page.getByTestId('cloud-checked-at')).toContainText('まだ確認していません');
    await expect(page.getByTestId('cloud-counts')).toContainText('—');

    await tap(page, 'cloud-check');
    const counts = page.getByTestId('cloud-counts');
    const log = () => `通信: ${mock.calls.map((c) => `${c.method} ${c.path}`).join(' | ') || 'なし'} / 画面: ${failures.join(' | ') || '異常なし'}`;
    await expect(counts.getByRole('row', { name: /商品/ }), log()).toContainText('2件', { timeout: 20000 });
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

    await tap(page, 'cloud-upload');
    await expect(page.getByTestId('cloud-plan')).toContainText('クラウドは空です');
    // 上書きの確認は不要
    await expect(page.getByTestId('cloud-confirm')).toHaveCount(0);
    await tap(page, 'cloud-run');
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

    await tap(page, 'cloud-upload');
    await expect(page.getByTestId('cloud-plan')).toContainText('クラウドに別の内容のデータがあります');
    await expect(page.getByTestId('cloud-run')).toBeDisabled();

    await tickConfirm(page);
    await expect(page.getByTestId('cloud-run')).toBeEnabled();
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');
    // 置き換わっている（クラウドの元データは残らない）
    expect(mock.db.products).toHaveLength(5);
    expect(mock.db.products.map((p) => p.name)).not.toContain('クラウドのお茶');
  });

  test('★この端末が空のときは保存できない（クラウドのデータを消さない）', async ({ page }) => {
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    await startEmptyLocal(page);
    await signIn(page);

    await tap(page, 'cloud-upload');
    await expect(page.getByTestId('cloud-plan')).toContainText('この端末にデータがありません');
    await expect(page.getByTestId('cloud-run')).toBeDisabled();
    await tap(page, 'cloud-cancel');

    // クラウドのデータはそのまま
    expect(mock.db.products).toHaveLength(2);
    expect(restCalls(mock).some((c) => c.method === 'DELETE')).toBe(false);
  });

  test('★クラウドが空のときは取得できない（この端末のデータを消さない）', async ({ page }) => {
    const mock = await mockSupabase(page);
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await tap(page, 'cloud-download');
    await expect(page.getByTestId('cloud-plan')).toContainText('クラウドにデータがありません');
    await expect(page.getByTestId('cloud-run')).toBeDisabled();

    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
    expect(restCalls(mock).some((c) => c.method === 'DELETE')).toBe(false);
  });

  test('取得は、確認してから実行できる（ファイルへのバックアップも保存でき、元に戻せる）', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);

    await tap(page, 'cloud-download');
    await expect(page.getByTestId('cloud-plan')).toContainText('この端末にも別の内容のデータがあります');
    await expect(page.getByTestId('cloud-preview')).toContainText('2026/9/25');

    // 確認がまだなので実行できない。押せない理由が表示される
    await expect(page.getByTestId('cloud-run')).toBeDisabled();
    await expect(page.getByTestId('cloud-run-hint')).toContainText('チェックを入れてください');

    // ファイルへのバックアップ（任意）も保存できる
    const download = page.waitForEvent('download');
    await tap(page, 'cloud-backup');
    expect((await download).suggestedFilename()).toMatch(/^shopping-price-backup-.*\.json$/);
    await expect(page.getByTestId('cloud-run')).toBeDisabled();

    await tickConfirm(page);
    await expect(page.getByTestId('cloud-run')).toBeEnabled();
    await expect(page.getByTestId('cloud-run-hint')).toHaveCount(0);

    await tap(page, 'cloud-run');
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
    await tap(page, 'cloud-upload');
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');

    await tap(page, 'cloud-download');
    await tap(page, 'cloud-compare');
    await expect(page.getByTestId('cloud-message')).toContainText('内容は同じでした');
    await expect(page.getByTestId('cloud-plan')).toContainText('同じです');
    await expect(page.getByTestId('cloud-confirm')).toHaveCount(0);
  });

  test('保存に失敗しても、この端末のデータは変わらない', async ({ page }) => {
    await mockSupabase(page, { failInsert: true });
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await tap(page, 'cloud-upload');
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存できませんでした');

    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
    // 画面は今までどおり使える
    await page.goto('/products');
    await expect(page.getByRole('main')).toContainText('サランラップ');
  });

  // 第16回: 保存の途中で失敗しても、クラウドを中途半端な状態で残さない
  test('★保存の途中で失敗したら、クラウドを保存前の内容に書き戻す', async ({ page }) => {
    const original = cloudFixture();
    const mock = await mockSupabase(page, { cloud: cloudFixture(), failInsertOnce: 'price_records' });
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await tap(page, 'cloud-upload');
    await tickConfirm(page);
    await tap(page, 'cloud-run');
    const message = page.getByTestId('cloud-message');
    await expect(message).toContainText('クラウドへ保存できませんでした');
    await expect(message).toContainText('保存前の内容に戻しました');

    // 商品・店舗だけ新しく、価格履歴が空…という状態ではなく、保存前と同じ内容に戻っている
    const names = (rows: Row[]) => rows.map((r) => `${r.id}:${r.name ?? r.product_id}`).sort();
    expect(names(mock.db.products)).toEqual(names(original.products));
    expect(names(mock.db.stores)).toEqual(names(original.stores));
    expect(mock.db.price_records.map((r) => r.id)).toEqual(original.price_records.map((r) => r.id));
    expect(mock.db.shopping_items).toEqual(original.shopping_items);
    // 端末のデータは変わらない
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
  });

  test('★書き戻しもできなかったときは、もう一度保存するよう案内する', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture(), failInsert: true });
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await tap(page, 'cloud-upload');
    await tickConfirm(page);
    await tap(page, 'cloud-run');
    const message = page.getByTestId('cloud-message');
    await expect(message).toContainText('クラウドへ保存できませんでした');
    await expect(message).toContainText('途中までの状態');
    await expect(message).toContainText('もう一度');
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
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
    await tap(page, 'cloud-check');
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

  test('クラウドが空でも、エラーにならず0件として表示される', async ({ page }) => {
    await mockSupabase(page);
    await signIn(page);
    await tap(page, 'cloud-check');

    const counts = page.getByTestId('cloud-counts');
    for (const label of ['商品', '店舗', '価格履歴', '買い物リスト']) {
      await expect(counts.getByRole('row', { name: new RegExp(label) })).toContainText('0件');
    }
    await expect(page.getByTestId('cloud-message')).toHaveCount(0);
    await expect(page.getByTestId('cloud-checked-at')).toContainText('クラウドの確認：');
  });

  test('★取得に失敗したときは、本文が空の応答でも原因の手がかりを表示する', async ({ page }) => {
    // 以前は HEAD で件数を取っていたため、エラーの本文が空になり理由が分からなかった
    await mockSupabase(page, { failSelect: { status: 404 } });
    await signIn(page);
    await tap(page, 'cloud-check');
    const message = page.getByTestId('cloud-message');
    await expect(message).toContainText('クラウドの件数を取得できませんでした');
    // 調査の手がかり（HTTPの番号）が添えられる
    await expect(message).toContainText(/HTTP \d{3}/);
    // 0件と誤表示しない
    await expect(page.getByTestId('cloud-counts')).toContainText('—');
  });

  test('テーブルが無いときは、準備が必要であることを表示する', async ({ page }) => {
    await mockSupabase(page, {
      failSelect: { status: 404, body: { code: 'PGRST205', message: "Could not find the table 'public.products' in the schema cache" } },
    });
    await signIn(page);
    await tap(page, 'cloud-check');
    await expect(page.getByTestId('cloud-message')).toContainText('テーブルの作成');
  });

  test('★テーブルの権限が無いときは、実行すべきSQLを案内する', async ({ page }) => {
    await mockSupabase(page, { failSelect: { status: 401, body: { code: '42501', message: 'permission denied for table products' } } });
    await signIn(page);
    await tap(page, 'cloud-check');
    const message = page.getByTestId('cloud-message');
    await expect(message).toContainText('権限設定');
    await expect(message).toContainText('grants');
    // 端末のデータは触らない
    await expect(page.getByTestId('cloud-counts')).toContainText('—');
  });

  test('ログインの期限切れのときは、ログインし直しを促す', async ({ page }) => {
    await mockSupabase(page, { failSelect: { status: 401, body: { message: 'JWT expired' } } });
    await signIn(page);
    await tap(page, 'cloud-check');
    await expect(page.getByTestId('cloud-message')).toContainText('ログイン');
  });

  test('件数のヘッダーが読めないときは、0件と誤表示せずエラーにする', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture(), hideCountHeader: true });
    await signIn(page);
    await tap(page, 'cloud-check');
    await expect(page.getByTestId('cloud-message')).toContainText('件数');
    await expect(page.getByTestId('cloud-counts')).toContainText('—');
  });

  test('通信できないときは、その旨を表示して端末のデータは変えない', async ({ page }) => {
    await mockSupabase(page);
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
    await page.route('**/supabase-mock/rest/v1/**', (route) => route.abort('failed'));

    await tap(page, 'cloud-check');
    // 通信エラーはライブラリ側が3回まで自動で再試行する（1+2+4秒）ため、少し長めに待つ
    await expect(page.getByTestId('cloud-message')).toContainText(/通信できませんでした|応答がありませんでした/, { timeout: 20000 });
    // 画面が「確認中…」のまま固まらない
    await expect(page.getByTestId('cloud-check')).toBeEnabled();
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
  });

  // ---------- 第13回: 復元（クラウド → この端末）の安全性 ----------

  test('プレビューに「どちらからどちらへ」と退避の案内が出る', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);

    await tap(page, 'cloud-upload');
    await expect(page.getByTestId('cloud-flow')).toContainText('この端末（そのまま残ります）');
    await expect(page.getByTestId('cloud-flow')).toContainText('クラウド（置き換わります）');
    await tap(page, 'cloud-cancel');

    await tap(page, 'cloud-download');
    await expect(page.getByTestId('cloud-flow')).toContainText('クラウド（そのまま残ります）');
    await expect(page.getByTestId('cloud-flow')).toContainText('この端末（置き換わります）');
    await expect(page.getByTestId('cloud-undo-note')).toContainText('復元前バックアップ');
    await expect(page.getByTestId('cloud-undo-note')).toContainText('1つ前の状態に戻す');
  });

  test('端末とクラウドの件数が同じときは、その旨を知らせる', async ({ page }) => {
    await mockSupabase(page);
    await signIn(page);
    await tap(page, 'cloud-upload');
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');
    await expect(page.getByTestId('cloud-diff')).toContainText('一致しています');
  });

  test('クラウド側にだけある追加データも、IDと参照関係を保ったまま取り込める', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);
    await tap(page, 'cloud-download');
    await tickConfirm(page);
    await saveBackup(page);
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('この端末へ取り込みました');

    const stored = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? '{}');
    // ID はクラウドのまま（勝手な再採番をしない）
    expect(stored.products.map((p: { id: string }) => p.id)).toEqual(['P001', 'P002']);
    expect(stored.stores.map((p: { id: string }) => p.id)).toEqual(['S001']);
    expect(stored.priceRecords.map((r: { id: string }) => r.id)).toEqual(['R001']);
    // 参照関係が保たれている
    const productIds = new Set(stored.products.map((p: { id: string }) => p.id));
    const storeIds = new Set(stored.stores.map((s: { id: string }) => s.id));
    for (const r of stored.priceRecords) {
      expect(productIds.has(r.productId)).toBe(true);
      expect(storeIds.has(r.storeId)).toBe(true);
    }
    for (const id of stored.shoppingList) expect(productIds.has(id)).toBe(true);
    // 形式は version 1 のまま、発番番号も引き継がれる
    expect(stored.version).toBe(1);
    expect(stored.counters).toEqual({ product: 2, store: 1, record: 1 });

    // 画面（価格登録・買い物候補）でも整合している
    await page.goto('/shopping');
    await expect(page.getByRole('main')).toContainText('クラウドのパン');
  });

  for (const table of ['products', 'stores', 'price_records', 'shopping_items', 'user_settings'] as const) {
    test('取り込みの途中で ' + table + ' の取得に失敗しても、この端末のデータは変わらない', async ({ page }) => {
      await mockSupabase(page, { cloud: cloudFixture(), failTable: { table, status: 500, body: { message: 'boom' } } });
      await signIn(page);
      const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

      // 件数の確認・プレビューまでは進める
      await tap(page, 'cloud-download');
      await expect(page.getByTestId('cloud-preview')).toBeVisible();
      await tickConfirm(page);
      await saveBackup(page);

      // 実行すると取得の途中で失敗する
      await tap(page, 'cloud-run');
      await expect(page.getByTestId('cloud-message')).toContainText('取得できませんでした');

      // 端末のデータは一切変わらない（中途半端な状態にならない）
      expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
      await page.goto('/products');
      await expect(page.getByRole('main')).toContainText('サランラップ');
    });
  }

  test('件数の確認に失敗したときは、プレビューを開かずに知らせる', async ({ page }) => {
    await mockSupabase(page, { failSelect: { status: 500, body: { message: 'boom' } } });
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await tap(page, 'cloud-download');
    await expect(page.getByTestId('cloud-message')).toBeVisible();
    await expect(page.getByTestId('cloud-preview')).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
  });

  test('★ほかの利用者の行が混ざっていたら、取り込まずに中止する', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture(), foreignRows: true });
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await tap(page, 'cloud-download');
    await tickConfirm(page);
    await saveBackup(page);
    await tap(page, 'cloud-run');

    await expect(page.getByTestId('cloud-message')).toContainText('ほかの利用者');
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
  });

  test('クラウドのデータが壊れていたら、取り込まずに中止する', async ({ page }) => {
    const broken = cloudFixture();
    // 価格記録が、存在しない商品を指している状態
    broken.price_records[0].product_id = 'P999';
    await mockSupabase(page, { cloud: broken });
    await signIn(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await tap(page, 'cloud-download');
    await tickConfirm(page);
    await saveBackup(page);
    await tap(page, 'cloud-run');

    await expect(page.getByTestId('cloud-message')).toContainText('読み込めませんでした');
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
  });

  test('ログアウトしても、取り込んだデータはこの端末に残る', async ({ page }) => {
    await mockSupabase(page, { cloud: cloudFixture() });
    await signIn(page);
    await tap(page, 'cloud-download');
    await tickConfirm(page);
    await saveBackup(page);
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('この端末へ取り込みました');
    const after = await page.evaluate((key) => localStorage.getItem(key), KEY);

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(after);
    await page.reload();
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(after);
  });

  // ---------- 第13回: 「この端末へ取得する」を押しても何も起きなかった不具合 ----------
  // 本番で起きた状態：クラウドは 商品5 / 店舗9 / 価格履歴10 / 買い物リスト4、
  // この端末は 商品5 / 店舗9 / 価格履歴10 / 買い物リスト0（＝サンプルデータ）。
  // 以前は「ファイルへのバックアップ」を押すまで実行ボタンが押せず、その理由も表示されなかった。

  test('★第13回: 買い物リストだけ違う状態から、確認のチェックだけで取り込める（5/9/10/0 → 5/9/10/4）', async ({ page }) => {
    const mock = await mockSupabase(page);
    await signIn(page);
    const before = (await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? '';
    // クラウドには、この端末と同じ内容＋買い物リスト4件（うち1件購入済み）を置く
    fillCloudFromLocal(mock, JSON.parse(before), ['P001', 'P003', 'P004', 'P005'], ['P004']);

    await tap(page, 'cloud-download');
    await expect(page.getByTestId('cloud-plan')).toContainText('この端末にも別の内容のデータがあります');
    const counts = page.getByTestId('cloud-counts');
    await expect(counts.getByRole('row', { name: /買い物リスト/ })).toContainText('0件');
    await expect(counts.getByRole('row', { name: /買い物リスト/ })).toContainText('4件');

    // チェック前は押せず、理由が出る
    await expect(page.getByTestId('cloud-run')).toBeDisabled();
    await expect(page.getByTestId('cloud-run-hint')).toContainText('この端末の内容が置き換わることを理解しました');

    // チェックを入れるだけで押せる（ファイルへのバックアップは押さない）
    await tickConfirm(page);
    await expect(page.getByTestId('cloud-run')).toBeEnabled();
    await tap(page, 'cloud-run');

    // 成功したことが分かる表示
    const message = page.getByTestId('cloud-message');
    await expect(message).toContainText('この端末へ取り込みました');
    await expect(message).toContainText('商品 5件 / 店舗 9件 / 価格履歴 10件 / 買い物リスト 4件');
    await expect(page.getByTestId('cloud-preview')).toHaveCount(0);
    // 件数の表も、この端末が4件になる
    for (const [label, n] of [['商品', 5], ['店舗', 9], ['価格履歴', 10], ['買い物リスト', 4]] as const) {
      await expect(counts.getByRole('row', { name: new RegExp(label) }).getByRole('cell').first()).toHaveText(`${n}件`);
    }

    // この端末の正本（localStorage）
    const stored = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? '{}');
    expect(stored.products).toHaveLength(5);
    expect(stored.stores).toHaveLength(9);
    expect(stored.priceRecords).toHaveLength(10);
    expect(stored.shoppingList).toEqual(['P001', 'P003', 'P004', 'P005']);
    expect(stored.purchased).toEqual(['P004']);
    expect(stored.version).toBe(1);

    // 取り込む前のデータは「復元前バックアップ」として退避されている
    const undo = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), UNDO_KEY)) ?? '{}');
    expect(undo.raw).toBe(before);
    expect(undo.reason).toBe('restore');

    // 再読み込みしても取り込んだ内容のまま
    await page.reload();
    const reloaded = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? '{}');
    expect(reloaded.shoppingList).toHaveLength(4);
  });

  test('★第13回: 端末への書き込みに失敗したら、理由を表示して端末のデータを変えない', async ({ page }) => {
    // 「復元前バックアップ」の書き込みだけを失敗させられるようにしておく（保存容量不足と同じ状態）
    await page.addInitScript((undoKey) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if ((window as unknown as { __failUndo?: boolean }).__failUndo && key === undoKey) {
          throw new DOMException('quota', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
    }, UNDO_KEY);
    const mock = await mockSupabase(page);
    await signIn(page);
    const before = (await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? '';
    fillCloudFromLocal(mock, JSON.parse(before), ['P001', 'P003', 'P004', 'P005'], []);

    await tap(page, 'cloud-download');
    await tickConfirm(page);
    await page.evaluate(() => ((window as unknown as { __failUndo?: boolean }).__failUndo = true));
    await tap(page, 'cloud-run');

    const message = page.getByTestId('cloud-message');
    await expect(message).toContainText('この端末へ取り込めませんでした');
    await expect(message).toContainText('退避できなかった');
    // 端末のデータはそのまま（中途半端な状態にならない）
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
    await expect(page.getByTestId('cloud-counts').getByRole('row', { name: /買い物リスト/ }).getByRole('cell').first()).toHaveText('0件');
    // 「実行中…」のまま固まらず、もう一度試せる
    await expect(page.getByTestId('cloud-run')).toBeEnabled();
    await expect(page.getByTestId('cloud-run')).toHaveText('この端末へ取得する');
  });

  // ---------- 第14回: 追加・更新・削除がクラウドへ正しく反映されるか ----------
  // 同期は「この端末の全データでクラウドを置き換える」方式。既存データには一切触れず、
  // テスト用の商品・店舗（価格履歴を付けない＝削除できる）だけを追加 → 更新 → 削除して確かめる。

  test('★第14回: テスト用の商品・店舗の追加・更新・削除が、既存データを変えずにクラウドへ反映される', async ({ page }) => {
    const mock = await mockSupabase(page);
    await signIn(page);
    const original = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? '{}') as LocalData;
    const names = (rows: Row[]) => rows.map((r) => `${r.id}:${r.name}`);
    const originalProducts = original.products.map((p) => `${p.id}:${p.name}`);
    const originalStores = original.stores.map((s) => `${s.id}:${s.name}`);

    /** この端末 → クラウド（クラウドに別の内容があれば確認のチェックを入れる） */
    async function upload() {
      await page.goto('/settings');
      await tap(page, 'cloud-upload');
      // プレビュー（クラウドの件数を読み終えてから開く）が出てから、確認が必要かを見る
      await expect(page.getByTestId('cloud-plan')).not.toBeEmpty();
      if (await page.getByTestId('cloud-confirm').count()) await tickConfirm(page);
      await tap(page, 'cloud-run');
      await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');
    }
    /** 既存の商品・店舗・価格履歴がクラウドでもそのまま残っているか */
    function expectExistingKept() {
      for (const p of originalProducts) expect(names(mock.db.products)).toContain(p);
      for (const s of originalStores) expect(names(mock.db.stores)).toContain(s);
      expect(mock.db.price_records).toHaveLength(original.priceRecords.length);
    }

    // 0. 最初の状態をクラウドへ（両方同じ内容にする）
    await upload();
    expect(mock.db.products).toHaveLength(5);

    // 1. 追加：テスト用の商品・店舗
    await page.goto('/products');
    await page.getByRole('button', { name: '＋ 商品登録' }).click();
    const pf = page.getByRole('form', { name: '商品登録' });
    await pf.getByLabel('カテゴリ').fill('テスト');
    await pf.getByLabel('品目').fill('【テスト】同期確認用');
    await pf.getByLabel('単位').fill('個');
    await pf.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByTestId('product-P006')).toBeVisible();
    await page.goto('/stores');
    await page.getByRole('button', { name: '＋ 店舗追加' }).click();
    await page.getByLabel('店舗名').fill('【テスト】同期確認用の店');
    await page.getByRole('button', { name: '追加する' }).click();
    await expect(page.getByTestId('store-S010')).toBeVisible();

    await upload();
    expect(mock.db.products).toHaveLength(6);
    expect(mock.db.stores).toHaveLength(10);
    expect(names(mock.db.products)).toContain('P006:【テスト】同期確認用');
    expect(names(mock.db.stores)).toContain('S010:【テスト】同期確認用の店');
    expectExistingKept();

    // 2. 更新：名前を変える（IDは変わらない）
    await page.goto('/products');
    await page.getByRole('button', { name: '【テスト】同期確認用を編集' }).click();
    await page.getByRole('form', { name: '商品の編集' }).getByLabel('品目').fill('【テスト】同期確認用（更新）');
    await page.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByTestId('product-P006')).toContainText('（更新）');
    await page.goto('/stores');
    await page.getByRole('button', { name: '【テスト】同期確認用の店を編集' }).click();
    await page.getByRole('form', { name: '店舗の編集' }).getByLabel('店舗名').fill('【テスト】同期確認用の店（更新）');
    await page.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByTestId('store-S010')).toContainText('（更新）');

    await upload();
    expect(mock.db.products).toHaveLength(6);
    expect(names(mock.db.products)).toContain('P006:【テスト】同期確認用（更新）');
    expect(names(mock.db.products)).not.toContain('P006:【テスト】同期確認用');
    expect(names(mock.db.stores)).toContain('S010:【テスト】同期確認用の店（更新）');
    expectExistingKept();

    // 3. 削除：価格履歴が無いので削除できる
    await page.goto('/products');
    await page.getByRole('button', { name: '【テスト】同期確認用（更新）を編集' }).click();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'この商品を削除' }).click();
    await expect(page.getByTestId('product-P006')).toHaveCount(0);
    await page.goto('/stores');
    await page.getByRole('button', { name: '【テスト】同期確認用の店（更新）を編集' }).click();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'この店舗を削除' }).click();
    await expect(page.getByTestId('store-S010')).toHaveCount(0);

    await upload();
    // クラウドからも消え、既存データは最初と同じ
    expect(names(mock.db.products)).toEqual(originalProducts);
    expect(names(mock.db.stores)).toEqual(originalStores);
    expect(mock.db.price_records).toHaveLength(original.priceRecords.length);

    // 4. クラウド → この端末 の側から見ても、内容が同じ（取り込んでも変わらない）
    await tap(page, 'cloud-download');
    await tap(page, 'cloud-compare');
    await expect(page.getByTestId('cloud-message')).toContainText('内容は同じでした');
    // この端末の既存データも最初と同じ
    const now = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? '{}') as LocalData;
    expect(now.products.map((p) => `${p.id}:${p.name}`)).toEqual(originalProducts);
    expect(now.stores.map((s) => `${s.id}:${s.name}`)).toEqual(originalStores);
    expect(now.priceRecords).toHaveLength(original.priceRecords.length);
  });


  // ---------- 第15回: 件数だけに頼らない差分の検知 ----------

  test('★件数が同じでも内容が違えば、そう表示される', async ({ page }) => {
    const mock = await mockSupabase(page);
    await signIn(page);

    // いったん保存して、クラウドと端末をまったく同じ内容にする
    await tap(page, 'cloud-upload');
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');
    await expect(page.getByTestId('cloud-diff')).toContainText('件数も内容も一致しています');

    // クラウド側だけ、商品名を1つ変える（件数は同じまま）
    mock.db.products[0].name = 'クラウドで変更された商品';
    await tap(page, 'cloud-check');
    // 件数しか見ていない段階では「同じとは限らない」と伝える
    await expect(page.getByTestId('cloud-diff')).toContainText('件数は一致しています');
    await expect(page.getByTestId('cloud-diff')).toContainText('同じとは限りません');

    // 内容まで照合すると、違いを検知できる
    await tap(page, 'cloud-verify');
    await expect(page.getByTestId('cloud-diff')).toContainText('件数は一致していますが、内容が異なります');
    await expect(page.getByTestId('cloud-diff')).toHaveAttribute('data-match', 'different');
  });

  test('照合したあとに端末のデータが変わったら、照合結果は未確認に戻る', async ({ page, context }) => {
    await mockSupabase(page);
    await signIn(page);
    await tap(page, 'cloud-upload');
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');
    await expect(page.getByTestId('cloud-diff')).toContainText('件数も内容も一致しています');
    await expect(page.getByTestId('cloud-diff')).toHaveAttribute('data-match', 'same');

    // データ管理の画面を開いたまま、別のタブで店舗を1件追加する（クラウドには触れない）
    const other = await context.newPage();
    await other.goto('/stores');
    await other.getByRole('button', { name: '＋ 店舗追加' }).click();
    const form = other.getByRole('form', { name: '店舗追加' });
    await form.getByLabel('店舗名').fill('第15回テスト店舗');
    await form.getByRole('button', { name: '追加する' }).click();
    await expect(other.getByRole('status')).toContainText('を追加しました');
    await other.close();

    // 元の画面の「一致しています」は取り消され、未確認に戻る
    await expect(page.getByTestId('cloud-diff')).toHaveAttribute('data-match', 'unknown');
    await expect(page.getByTestId('cloud-diff')).toContainText('件数が異なります');
  });

  // ---------- 第15回: クラウドの最終保存日時の扱い ----------

  test('★「状態を確認」だけではクラウドを書き換えない（最終保存日時も変わらない）', async ({ page }) => {
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    const before = mock.db.user_settings[0].last_synced_at;
    await signIn(page);

    await tap(page, 'cloud-check');
    await expect(page.getByTestId('cloud-updated-at')).toContainText('クラウドの最終保存：2026/9/25');
    await tap(page, 'cloud-verify');
    await expect(page.getByTestId('cloud-message')).toBeVisible();

    // 書き込みの通信は一度も発生していない
    expect(restCalls(mock).filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && c.method !== 'OPTIONS')).toEqual([]);
    expect(mock.db.user_settings[0].last_synced_at).toBe(before);
  });

  test('★クラウドへ保存できたときだけ、最終保存日時が進む', async ({ page }) => {
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    const before = String(mock.db.user_settings[0].last_synced_at);
    await signIn(page);

    await tap(page, 'cloud-upload');
    await tickConfirm(page);
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('クラウドへ保存しました');

    const after = String(mock.db.user_settings[0].last_synced_at);
    expect(after).not.toBe(before);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    await expect(page.getByTestId('cloud-updated-at')).toContainText('クラウドの最終保存：');
  });

  test('★取得（クラウド → この端末）ではクラウド側の最終保存日時を書き換えない', async ({ page }) => {
    const mock = await mockSupabase(page, { cloud: cloudFixture() });
    const before = mock.db.user_settings[0].last_synced_at;
    await signIn(page);

    await tap(page, 'cloud-download');
    await tickConfirm(page);
    await tap(page, 'cloud-run');
    await expect(page.getByTestId('cloud-message')).toContainText('この端末へ取り込みました');

    expect(mock.db.user_settings[0].last_synced_at).toBe(before);
    // クラウドへの書き込みは発生していない
    expect(restCalls(mock).filter((c) => c.method === 'POST' || c.method === 'DELETE' || c.method === 'PATCH')).toEqual([]);
    // 画面にも、取得前に確認した保存日時がそのまま出る
    await expect(page.getByTestId('cloud-updated-at')).toContainText('クラウドの最終保存：2026/9/25');
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

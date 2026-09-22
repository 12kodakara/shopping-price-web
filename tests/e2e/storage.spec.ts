import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

// 第2回: localStorage への保存と、各画面への反映
// Playwright はテストごとに新しいブラウザ環境を使うため、各テストはサンプルデータから始まる。

const KEY = 'shopping-price-web/v1';

interface Saved {
  products: { id: string; name: string }[];
  stores: { id: string; name: string }[];
  priceRecords: { id: string; productId: string; storeId: string; price: number; quantity: number; date: string }[];
  shoppingList: string[];
}

async function saved(page: Page): Promise<Saved> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
}

/** 価格比較の行（PCは表、スマホはカード） */
function compareItem(page: Page, info: TestInfo, productId: string): Locator {
  return info.project.name === 'smartphone' ? page.getByTestId(`compare-card-${productId}`) : page.getByTestId(`compare-row-${productId}`);
}

async function registerPrice(page: Page, p: { product: string; store: string; date?: string; quantity: string; price: string }) {
  await page.goto('/prices/new');
  await page.locator('#product').selectOption(p.product);
  await page.locator('#store').selectOption(p.store);
  if (p.date) await page.locator('#date').fill(p.date);
  await page.locator('#quantity').fill(p.quantity);
  await page.locator('#price').fill(p.price);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByRole('status')).toContainText('価格を登録しました');
}

test.describe('初回データ・保存', () => {
  test('初回起動でサンプルデータが保存される', async ({ page }) => {
    await page.goto('/');
    const data = await saved(page);
    expect(data.products.map((p) => p.id)).toEqual(['P001', 'P002', 'P003', 'P004', 'P005']);
    expect(data.stores).toHaveLength(9);
    expect(data.priceRecords).toHaveLength(10);
  });

  test('Excel版と同じ最安単価が表示される', async ({ page }, info) => {
    await page.goto('/compare');
    const expected: [string, string, string][] = [
      ['P001', 'コストコ', '433'],
      ['P002', 'コストコ', '424.5'],
      ['P003', 'コストコ', '199.8'],
      ['P004', 'コストコ', '596'],
      ['P005', 'ミスターマックス', '140'],
    ];
    for (const [id, store, price] of expected) {
      const item = compareItem(page, info, id);
      await expect(item).toContainText(store);
      await expect(item.locator('.price-lg, td.num .price-md').first()).toContainText(price);
    }
  });
});

test.describe('価格登録', () => {
  test('登録すると保存され、再読み込み後も各画面に反映される', async ({ page }, info) => {
    // サランラップ: ドン・キホーテで1本398円（目安430円 → 32円安い／これまでの最安433円）
    await registerPrice(page, { product: 'P001', store: 'S003', date: '2026-09-23', quantity: '1', price: '398' });
    await expect(page.getByTestId('saved-summary')).toContainText('サランラップ');
    await expect(page.getByTestId('saved-summary')).toContainText('日用品');
    await expect(page.getByTestId('saved-summary')).toContainText('398');

    let data = await saved(page);
    expect(data.priceRecords).toHaveLength(11);
    expect(data.priceRecords.at(-1)).toMatchObject({ id: 'R011', productId: 'P001', storeId: 'S003', quantity: 1, price: 398, date: '2026-09-23' });

    await page.reload();
    data = await saved(page);
    expect(data.priceRecords).toHaveLength(11);

    // ホーム: 最近登録した価格の先頭、買い物候補が 4 → 5 件
    await page.goto('/');
    await expect(page.getByTestId('recent-item').first()).toContainText('サランラップ');
    await expect(page.getByTestId('recent-item').first()).toContainText('ドン・キホーテ');
    await expect(page.getByTestId('stat-shopping')).toContainText('5');

    // 価格比較: 最安店がドン・キホーテ、398円、目安より32円安い
    await page.goto('/compare');
    const row = compareItem(page, info, 'P001');
    await expect(row).toContainText('ドン・キホーテ');
    await expect(row).toContainText('398');
    await expect(row).toContainText('目安より32円安い');

    // 買い物候補: 差が一番大きいので先頭
    await page.goto('/shopping');
    await expect(page.getByTestId('candidate-count')).toHaveText('5');
    await expect(page.getByTestId('candidate-list').locator('> li').first()).toContainText('サランラップ');

    // 価格履歴: 現在398円、前回433円、前回比 −35円、記録3件
    await page.goto('/history?product=P001');
    await expect(page.getByTestId('hist-current')).toContainText('398');
    await expect(page.getByTestId('hist-previous')).toContainText('433');
    await expect(page.getByTestId('hist-change')).toContainText('35');
    await expect(page.getByTestId('hist-lowest')).toContainText('398');
    await expect(page.getByTestId('hist-lowest-diff')).toContainText('最安');
    await expect(page.getByTestId('hist-count')).toContainText('3');
    await expect(page.getByTestId('history-item').first()).toContainText('ドン・キホーテ');
  });

  test('同じ店で値上がりしたら、その店の最新価格で比較する', async ({ page }, info) => {
    // ミスターマックスの麦茶: 9/22 に 140円/本 → 9/23 に 170円/本
    await registerPrice(page, { product: 'P005', store: 'S009', date: '2026-09-23', quantity: '6', price: '1020' });
    await page.goto('/compare');
    const row = compareItem(page, info, 'P005');
    await expect(row).toContainText('ドン・キホーテ'); // 次に安い 158円
    await expect(row).toContainText('158');
    await page.goto('/history?product=P005');
    await expect(page.getByTestId('hist-current')).toContainText('170');
    await expect(page.getByTestId('hist-change')).toContainText('+30');
    await expect(page.getByTestId('hist-lowest-diff')).toContainText('30');
  });

  test('不正な入力は保存せず、入力欄の近くにエラーを表示する', async ({ page }) => {
    await page.goto('/prices/new');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.locator('#product-error')).toContainText('商品を選んでください');
    await expect(page.locator('#store-error')).toContainText('店舗を選んでください');
    await expect(page.locator('#quantity-error')).toBeVisible();
    await expect(page.locator('#price-error')).toBeVisible();
    await expect(page.locator('#product')).toHaveAttribute('aria-invalid', 'true');

    await page.locator('#product').selectOption('P005');
    await page.locator('#store').selectOption('S009');
    await page.locator('#quantity').fill('0');
    await page.locator('#price').fill('-100');
    await page.locator('#date').fill('');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.locator('#quantity-error')).toContainText('0より大きい');
    await expect(page.locator('#price-error')).toContainText('0より大きい');
    await expect(page.locator('#date-error')).toBeVisible();
    await expect(page.locator('#product-error')).toHaveCount(0);

    expect((await saved(page)).priceRecords).toHaveLength(10);
  });

  test('ダブルクリックしても1件だけ登録される', async ({ page }) => {
    await page.goto('/prices/new');
    await page.locator('#product').selectOption('P004');
    await page.locator('#store').selectOption('S002');
    await page.locator('#quantity').fill('5');
    await page.locator('#price').fill('2890');
    await page.getByRole('button', { name: '登録する' }).dblclick();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
    await page.waitForTimeout(300);
    expect((await saved(page)).priceRecords).toHaveLength(11);
  });

  test('登録後は店舗・日付を残し、続けて入力できる', async ({ page }) => {
    await registerPrice(page, { product: 'P002', store: 'S002', quantity: '1', price: '398' });
    await expect(page.locator('#store')).toHaveValue('S002');
    await expect(page.locator('#product')).toHaveValue('');
    await expect(page.locator('#price')).toHaveValue('');
  });
});

test.describe('商品追加', () => {
  test('P006 が自動発番され、再読み込み後も残り、価格登録で選べる', async ({ page }, info) => {
    await page.goto('/products');
    await page.getByRole('button', { name: '＋ 商品登録' }).click();
    const form = page.getByRole('form', { name: '商品登録' });
    await form.getByLabel('カテゴリ').fill('飲料');
    await form.getByLabel('品目').fill('天然水');
    await form.getByLabel('基準数量').fill('1');
    await form.getByLabel('単位').fill('L');
    await form.getByLabel('目安単価（円）').fill('50');
    await form.getByLabel('メーカー').fill('サントリー');
    await form.getByRole('button', { name: '登録する' }).click();

    await expect(page.getByRole('status')).toContainText('P006 天然水 を登録しました');
    await expect(form).toBeHidden();
    await expect(page.getByTestId('product-P006')).toContainText('天然水');

    await page.reload();
    await expect(page.getByTestId('product-P006')).toContainText('天然水');
    await expect(page.getByTestId('product-P006')).toContainText('1Lあたり');

    await page.goto('/prices/new');
    await page.locator('#product').selectOption('P006');
    await page.locator('#quantity').fill('12');
    await page.locator('#price').fill('540');
    await expect(page.getByTestId('price-result')).toContainText('45');
    await expect(page.getByTestId('result-verdict')).toContainText('目安より5円安い');

    // 価格未登録の商品は比較で「価格未登録」
    await page.goto('/compare');
    await expect(compareItem(page, info, 'P006')).toContainText('価格未登録');
  });

  test('続けて追加すると P007', async ({ page }) => {
    await page.goto('/products');
    for (const name of ['商品A', '商品B']) {
      await page.getByRole('button', { name: '＋ 商品登録' }).click();
      const form = page.getByRole('form', { name: '商品登録' });
      await form.getByLabel('カテゴリ').fill('日用品');
      await form.getByLabel('品目').fill(name);
      await form.getByLabel('単位').fill('個');
      await form.getByRole('button', { name: '登録する' }).click();
      await expect(form).toBeHidden();
    }
    const data = await saved(page);
    expect(data.products.slice(-2).map((p) => [p.id, p.name])).toEqual([['P006', '商品A'], ['P007', '商品B']]);
  });

  test('不正な入力は保存せず、エラーを表示する', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('button', { name: '＋ 商品登録' }).click();
    const form = page.getByRole('form', { name: '商品登録' });
    await form.getByLabel('基準数量').fill('0');
    await form.getByLabel('目安単価（円）').fill('-5');
    await form.getByRole('button', { name: '登録する' }).click();
    await expect(page.locator('#product-category-error')).toContainText('カテゴリを入力してください');
    await expect(page.locator('#product-name-error')).toContainText('品目を入力してください');
    await expect(page.locator('#product-unitAmount-error')).toContainText('0より大きい');
    await expect(page.locator('#product-unit-error')).toContainText('単位を入力してください');
    await expect(page.locator('#product-targetUnitPrice-error')).toContainText('0以上');
    await expect(form).toBeVisible();
    expect((await saved(page)).products).toHaveLength(5);
  });

  test('商品名を変更しても、商品IDで価格履歴が維持される', async ({ page }, info) => {
    await page.goto('/products');
    await page.getByRole('button', { name: 'やさしい麦茶を編集' }).click();
    const form = page.getByRole('form', { name: '商品の編集' });
    await form.getByLabel('品目').fill('麦茶（名前変更後）');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('status')).toContainText('P005 麦茶（名前変更後） を更新しました');

    await page.reload();
    await page.goto('/history?product=P005');
    await expect(page.locator('#history-product')).toContainText('麦茶（名前変更後）');
    await expect(page.getByTestId('hist-count')).toContainText('4');
    await expect(page.getByTestId('hist-current')).toContainText('140');

    await page.goto('/compare');
    await expect(compareItem(page, info, 'P005')).toContainText('麦茶（名前変更後）');
    await expect(compareItem(page, info, 'P005')).toContainText('140');
    const data = await saved(page);
    expect(data.products.filter((p) => p.id === 'P005')).toHaveLength(1);
  });
});

test.describe('店舗追加', () => {
  test('S010 が自動発番され、価格登録で選べる', async ({ page }) => {
    await page.goto('/stores');
    await page.getByRole('button', { name: '＋ 店舗追加' }).click();
    const form = page.getByRole('form', { name: '店舗追加' });
    await form.getByRole('button', { name: '追加する' }).click();
    await expect(page.locator('#store-name-error')).toContainText('店舗名を入力してください');
    expect((await saved(page)).stores).toHaveLength(9);

    await form.getByLabel('店舗名').fill('業務スーパー');
    await form.getByRole('button', { name: '追加する' }).click();
    await expect(page.getByRole('status')).toContainText('S010 業務スーパー を追加しました');
    await expect(page.getByTestId('store-S010')).toContainText('業務スーパー');

    await page.reload();
    await expect(page.getByTestId('store-list').locator('> li')).toHaveCount(10);
    await registerPrice(page, { product: 'P005', store: 'S010', quantity: '6', price: '798' });
    const data = await saved(page);
    expect(data.priceRecords.at(-1)).toMatchObject({ storeId: 'S010' });
  });
});

test.describe('買い物リスト', () => {
  test('「今回買う」は再読み込み後も残る', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByTestId('candidate-P005').getByRole('button', { name: /今回買う/ }).click();
    await expect(page.getByTestId('selected-count')).toHaveText('1');
    await page.reload();
    await expect(page.getByTestId('selected-count')).toHaveText('1');
    await expect(page.getByTestId('candidate-P005').getByRole('button', { name: /今回買う/ })).toHaveAttribute('aria-pressed', 'true');
    expect((await saved(page)).shoppingList).toEqual(['P005']);
  });
});

test.describe('データ破損・初期化', () => {
  test('壊れた保存データでもアプリが表示され、データは消えない', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.evaluate((key) => localStorage.setItem(key, '{"version":1,"products":[壊れた'), KEY);
    await page.reload();

    await expect(page.getByTestId('data-error')).toContainText('保存データを読み込めませんでした');
    // ナビゲーションは表示されたまま
    const nav = page.getByTestId(test.info().project.name === 'smartphone' ? 'bottom-nav' : 'sidebar-nav');
    await expect(nav).toBeVisible();
    await page.goto('/compare');
    await expect(page.getByTestId('data-error')).toBeVisible();
    expect(errors).toEqual([]);
    // 自動で削除・上書きしていない
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('{"version":1,"products":[壊れた');

    // 確認ダイアログで「キャンセル」なら何もしない
    page.once('dialog', (d) => d.dismiss());
    await page.getByTestId('data-error').getByRole('button', { name: 'サンプルデータに戻す' }).click();
    await expect(page.getByTestId('data-error')).toBeVisible();

    // 「OK」でサンプルデータに戻る（壊れたデータは退避される）
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('data-error').getByRole('button', { name: 'サンプルデータに戻す' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '価格比較' })).toBeVisible();
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.some((k) => k.startsWith('shopping-price-web/backup/'))).toBe(true);
    expect((await saved(page)).products).toHaveLength(5);
  });

  test('データ管理画面の「サンプルデータに戻す」は確認後に実行される', async ({ page }) => {
    await registerPrice(page, { product: 'P001', store: 'S002', quantity: '1', price: '450' });
    await page.goto('/settings');
    await expect(page.getByTestId('storage-status')).toContainText('保存しています');

    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'サンプルデータに戻す' }).click();
    expect((await saved(page)).priceRecords).toHaveLength(11);

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'サンプルデータに戻す' }).click();
    await expect(page.getByRole('status')).toContainText('サンプルデータに戻しました');
    expect((await saved(page)).priceRecords).toHaveLength(10);
  });

  test('データ管理はPCサイドバー・スマホメニューから開ける', async ({ page }, info) => {
    await page.goto('/');
    if (info.project.name === 'smartphone') {
      await page.getByRole('button', { name: 'メニューを開く' }).click();
      await page.getByRole('dialog').getByRole('link', { name: 'データ管理' }).click();
    } else {
      await page.getByRole('complementary').getByRole('link', { name: 'データ管理' }).click();
    }
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'データ管理' })).toBeVisible();
  });
});

test.describe('第2回で追加した画面状態のレイアウト', () => {
  async function expectNoHorizontalScroll(page: Page) {
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw, '横スクロールが発生している').toBeLessThanOrEqual(cw);
  }

  test('エラー表示・登録完了・各フォーム・データ管理・破損画面で横スクロールが出ない', async ({ page }) => {
    await page.goto('/prices/new');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.locator('#product')).toBeFocused(); // 最初のエラー欄へ移動
    await expectNoHorizontalScroll(page);

    await registerPrice(page, { product: 'P001', store: 'S003', quantity: '1', price: '398' });
    await expect(page.getByTestId('saved-summary')).toBeInViewport();
    await expectNoHorizontalScroll(page);

    await page.goto('/products');
    await page.getByRole('button', { name: '＋ 商品登録' }).click();
    await page.getByRole('form', { name: '商品登録' }).getByRole('button', { name: '登録する' }).click();
    await expectNoHorizontalScroll(page);

    await page.goto('/stores');
    await page.getByRole('button', { name: '＋ 店舗追加' }).click();
    await expectNoHorizontalScroll(page);

    await page.goto('/settings');
    await expectNoHorizontalScroll(page);

    await page.evaluate((key) => localStorage.setItem(key, '{broken'), KEY);
    await page.reload();
    await expect(page.getByTestId('data-error')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

// 第3回: バックアップ・復元、商品・店舗・価格記録の編集、削除・使用停止

const KEY = 'shopping-price-web/v1';

interface Saved {
  version: number;
  products: { id: string; name: string; archived?: boolean; category: string; unit: string; unitAmount: number; targetUnitPrice: number | null; maker?: string; memo?: string }[];
  stores: { id: string; name: string; type?: string; memo?: string; archived?: boolean }[];
  priceRecords: { id: string; productId: string; storeId: string; price: number; quantity: number; date: string; note?: string }[];
  shoppingList: string[];
  counters: { product: number; store: number; record: number };
}

const saved = (page: Page): Promise<Saved> => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
const rawSaved = (page: Page): Promise<string | null> => page.evaluate((key) => localStorage.getItem(key), KEY);
const isSp = (info: TestInfo) => info.project.name === 'smartphone';

function compareItem(page: Page, info: TestInfo, productId: string): Locator {
  return isSp(info) ? page.getByTestId(`compare-card-${productId}`) : page.getByTestId(`compare-row-${productId}`);
}

async function expectNoHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, '横スクロールが発生している').toBeLessThanOrEqual(cw);
}

/** データ管理画面で「バックアップを保存」し、ダウンロードされたファイルの名前と中身を返す */
async function downloadBackup(page: Page): Promise<{ filename: string; text: string }> {
  await page.goto('/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
  const path = await download.path();
  return { filename: download.suggestedFilename(), text: readFileSync(path, 'utf-8') };
}

async function chooseRestoreFile(page: Page, text: string, name = 'backup.json') {
  await page.locator('#restore-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text, 'utf-8') });
}

/** 価格履歴で記録を開いて修正フォームを出す */
async function openRecordEditor(page: Page, productId: string, recordId: string) {
  await page.goto(`/history?product=${productId}`);
  await page.getByRole('button', { name: new RegExp(`（${recordId}）を修正`) }).click();
  const form = page.getByRole('form', { name: '価格記録の修正' });
  await expect(form).toBeVisible();
  return form;
}

test.describe('バックアップ', () => {
  test('JSONファイルとして保存でき、version と全データを含む', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByTestId('candidate-P005').getByRole('button', { name: /今回買う/ }).click();
    const { filename, text } = await downloadBackup(page);
    expect(filename).toMatch(/^shopping-price-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const json = JSON.parse(text);
    expect(json.app).toBe('shopping-price-web');
    expect(json.version).toBe(1);
    expect(typeof json.exportedAt).toBe('string');
    expect(json.products).toHaveLength(5);
    expect(json.stores).toHaveLength(9);
    expect(json.priceRecords).toHaveLength(10);
    expect(json.shoppingList).toEqual(['P005']);
    expect(json.counters).toEqual({ product: 5, store: 9, record: 10 });
    await expect(page.getByRole('status')).toContainText('バックアップを保存しました');
  });

  test('保存状況（件数・おおよその使用量）を表示する', async ({ page }) => {
    await page.goto('/settings');
    const summary = page.getByTestId('storage-summary');
    await expect(summary).toContainText('商品5件');
    await expect(summary).toContainText('店舗9件');
    await expect(summary).toContainText('価格履歴10件');
    await expect(summary).toContainText('買い物リスト0件');
    await expect(page.getByTestId('storage-usage')).toContainText(/約 [\d.]+ KB/);
    await expect(page.getByTestId('storage-usage')).toContainText('上限はブラウザや端末によって異なります');
  });
});

test.describe('復元', () => {
  test('ファイル選択 → 概要確認 → 確認ダイアログ → 復元 → 1つ前に戻す', async ({ page }) => {
    const { text } = await downloadBackup(page);

    // バックアップ後に店舗を追加（現在10店舗）
    await page.goto('/stores');
    await page.getByRole('button', { name: '＋ 店舗追加' }).click();
    await page.getByLabel('店舗名').fill('業務スーパー');
    await page.getByRole('button', { name: '追加する' }).click();
    await expect(page.getByTestId('store-S010')).toBeVisible();

    await page.goto('/settings');
    await chooseRestoreFile(page, text, 'my-backup.json');
    const preview = page.getByTestId('restore-preview');
    await expect(preview).toContainText('my-backup.json');
    await expect(preview.getByTestId('summary-products')).toContainText('5件');
    await expect(preview.getByTestId('summary-stores')).toContainText('10件'); // 現在
    await expect(preview.getByTestId('summary-stores')).toContainText('9件'); // バックアップ
    await expect(preview.getByTestId('summary-priceRecords')).toContainText('10件');
    await expect(preview.getByTestId('summary-shoppingList')).toContainText('0件');
    // ファイルを選んだだけでは変わらない
    expect((await saved(page)).stores).toHaveLength(10);

    // 確認ダイアログでキャンセル → 変わらない
    page.once('dialog', (d) => d.dismiss());
    await preview.getByRole('button', { name: 'この内容で復元する' }).click();
    expect((await saved(page)).stores).toHaveLength(10);

    // OK → 復元
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      d.accept();
    });
    await preview.getByRole('button', { name: 'この内容で復元する' }).click();
    expect(message).toContain('店舗 9件');
    await expect(page.getByRole('status')).toContainText('バックアップから復元しました');
    await expect(preview).toBeHidden();
    expect((await saved(page)).stores).toHaveLength(9);
    await page.goto('/stores');
    await expect(page.getByTestId('store-list').locator('> li')).toHaveCount(9);

    // 1つ前の状態に戻す
    await page.goto('/settings');
    const undo = page.getByTestId('undo-card');
    await expect(undo).toContainText('復元');
    page.once('dialog', (d) => d.accept());
    await undo.getByRole('button', { name: '1つ前の状態に戻す' }).click();
    await expect(page.getByRole('status')).toContainText('1つ前の状態に戻しました');
    expect((await saved(page)).stores).toHaveLength(10);
    await expect(page.getByTestId('undo-card')).toBeHidden();
  });

  const invalid: [string, string, string][] = [
    ['壊れたJSON', '{"version":1,"products":[', 'JSONとして読み込めません'],
    ['対応していないversion', JSON.stringify({ version: 2, products: [], stores: [], priceRecords: [], shoppingList: [], counters: { product: 0, store: 0, record: 0 } }), '新しい形式'],
    ['必要なデータがない', JSON.stringify({ version: 1, products: [] }), '店舗データがありません'],
    ['商品IDが不正', JSON.stringify({ version: 1, products: [{ id: 'X', category: '', name: 'a', unitAmount: 1, unit: '本', targetUnitPrice: null }], stores: [], priceRecords: [], shoppingList: [], counters: { product: 0, store: 0, record: 0 } }), '商品IDが正しくありません'],
    ['別のファイル', JSON.stringify({ name: 'package', dependencies: {} }), 'version がありません'],
  ];

  for (const [label, text, expected] of invalid) {
    test(`不正なファイルは復元せず、理由を表示する：${label}`, async ({ page }) => {
      await page.goto('/settings');
      const before = await rawSaved(page);
      await chooseRestoreFile(page, text);
      await expect(page.getByTestId('restore-error')).toContainText('このファイルは復元できません');
      await expect(page.getByTestId('restore-error')).toContainText(expected);
      await expect(page.getByTestId('restore-error')).toContainText('現在のデータは変更していません');
      await expect(page.getByTestId('restore-preview')).toBeHidden();
      expect(await rawSaved(page)).toBe(before);
      await expectNoHorizontalScroll(page);
    });
  }

  test('価格が不正なバックアップも拒否する', async ({ page }) => {
    const { text } = await downloadBackup(page);
    const json = JSON.parse(text);
    json.priceRecords[0].price = -500;
    const before = await rawSaved(page);
    await chooseRestoreFile(page, JSON.stringify(json));
    await expect(page.getByTestId('restore-error')).toContainText('販売価格が正しくありません');
    expect(await rawSaved(page)).toBe(before);
  });

  test('保存データが壊れていても、復旧画面からバックアップで復元できる', async ({ page }) => {
    const { text } = await downloadBackup(page);
    await page.evaluate((key) => localStorage.setItem(key, '{壊れた'), KEY);
    await page.goto('/');
    await expect(page.getByTestId('data-error')).toBeVisible();
    await chooseRestoreFile(page, text);
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('restore-preview').getByRole('button', { name: 'この内容で復元する' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    expect((await saved(page)).priceRecords).toHaveLength(10);
  });
});

test.describe('商品・店舗の編集', () => {
  test('商品の全項目を編集でき、IDは変わらない', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('button', { name: 'つや姫を編集' }).click();
    const form = page.getByRole('form', { name: '商品の編集' });
    await expect(form).toContainText('P004');
    await form.getByLabel('カテゴリ').fill('米');
    await form.getByLabel('品目').fill('つや姫 無洗米');
    await form.getByLabel('基準数量').fill('5');
    await form.getByLabel('単位').fill('kg');
    await form.getByLabel('目安単価（円）').fill('2900');
    await form.getByLabel('メーカー').fill('JA');
    await form.getByLabel('メモ').fill('5kg袋');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('status')).toContainText('P004 つや姫 無洗米 を更新しました');

    const p = (await saved(page)).products.find((x) => x.id === 'P004')!;
    expect(p).toMatchObject({ category: '米', name: 'つや姫 無洗米', unitAmount: 5, unit: 'kg', targetUnitPrice: 2900, maker: 'JA', memo: '5kg袋' });
    // 5kgあたりで再計算（596円/kg × 5 = 2980円 → 目安2900円より80円高い）
    await page.goto('/compare');
    await expect(page.locator('body')).toContainText('つや姫 無洗米');
    await page.goto('/history?product=P004');
    await expect(page.getByTestId('hist-count')).toContainText('2');
    await expect(page.getByTestId('hist-current')).toContainText('2,980');
  });

  test('店舗名を変更しても、価格履歴・価格比較の紐付けが維持される', async ({ page }, info) => {
    await page.goto('/stores');
    await page.getByRole('button', { name: 'ミスターマックスを編集' }).click();
    const form = page.getByRole('form', { name: '店舗の編集' });
    await expect(form).toContainText('S009');
    await form.getByLabel('店舗名').fill('MrMax 本店');
    await form.getByLabel('種類').fill('ディスカウント');
    await form.getByLabel('メモ').fill('駐車場あり');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('status')).toContainText('S009 MrMax 本店 を更新しました');
    await page.reload();
    await expect(page.getByTestId('store-S009')).toContainText('MrMax 本店');
    await expect(page.getByTestId('store-S009')).toContainText('記録 2件');

    await page.goto('/compare');
    await expect(compareItem(page, info, 'P005')).toContainText('MrMax 本店');
    await page.goto('/history?product=P005');
    await expect(page.getByTestId('history-item').first()).toContainText('MrMax 本店');
    await expect(page.getByTestId('hist-count')).toContainText('4');
  });
});

test.describe('価格記録の編集・削除', () => {
  test('価格を修正すると、単価・価格比較・買い物候補・履歴が再計算される', async ({ page }, info) => {
    // やさしい麦茶 ミスターマックス 6本 840円（R010）→ 1020円（170円/本、目安160円より高い）
    const form = await openRecordEditor(page, 'P005', 'R010');
    await expect(form.getByTestId('record-editor-unit-price')).toContainText('140');
    await form.getByLabel('販売価格').fill('1020');
    await expect(form.getByTestId('record-editor-unit-price')).toContainText('170');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('status')).toContainText('R010 を修正しました');
    await expect(form).toBeHidden();

    await expect(page.getByTestId('hist-current')).toContainText('170');
    await expect(page.getByTestId('hist-lowest')).toContainText('150');
    await expect(page.getByTestId('history-item').first()).toContainText('修正済み');
    const rec = (await saved(page)).priceRecords.find((r) => r.id === 'R010')!;
    expect(rec).toMatchObject({ price: 1020, quantity: 6 });

    await page.goto('/compare');
    const row = compareItem(page, info, 'P005');
    await expect(row).toContainText('ドン・キホーテ');
    await expect(row).toContainText('158');
    await expect(row).toContainText('目安より2円安い');

    await page.goto('/shopping');
    await expect(page.getByTestId('candidate-list').locator('> li').first()).toContainText('クレラップ');
    await expect(page.getByTestId('candidate-P005')).toContainText('ドン・キホーテ');
  });

  test('修正時も入力チェックを行い、不正なら保存しない', async ({ page }) => {
    const form = await openRecordEditor(page, 'P005', 'R010');
    const before = await rawSaved(page);
    await form.getByLabel('販売数量').fill('0');
    await form.getByLabel('販売価格').fill('');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.locator('#rec-quantity-error')).toContainText('0より大きい');
    await expect(page.locator('#rec-price-error')).toContainText('販売価格を入力してください');
    expect(await rawSaved(page)).toBe(before);
  });

  test('価格登録直後の「修正する」から修正できる', async ({ page }) => {
    await page.goto('/prices/new');
    await page.locator('#product').selectOption('P002');
    await page.locator('#store').selectOption('S002');
    await page.locator('#quantity').fill('1');
    await page.locator('#price').fill('4000'); // 400円の打ち間違い
    await page.getByRole('button', { name: '登録する' }).click();
    await page.getByTestId('saved-summary').getByRole('link', { name: '修正する' }).click();
    const form = page.getByRole('form', { name: '価格記録の修正' });
    await expect(form).toContainText('R011');
    await expect(form.getByLabel('販売価格')).toBeInViewport(); // 画面の下の方に隠れていない
    await form.getByLabel('販売価格').fill('400');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByTestId('hist-current')).toContainText('400');
  });

  test('削除は確認ダイアログで削除対象を示し、キャンセルなら削除しない', async ({ page }) => {
    const form = await openRecordEditor(page, 'P005', 'R010');
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      d.dismiss();
    });
    await form.getByRole('button', { name: 'この記録を削除' }).click();
    expect(message).toContain('2026-09-22');
    expect(message).toContain('やさしい麦茶');
    expect(message).toContain('ミスターマックス');
    expect(message).toContain('840円');
    expect(message).toContain('R010');
    expect((await saved(page)).priceRecords).toHaveLength(10);
    await expect(form).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await form.getByRole('button', { name: 'この記録を削除' }).click();
    await expect(page.getByRole('status')).toContainText('R010 を削除しました');
    const data = await saved(page);
    expect(data.priceRecords).toHaveLength(9);
    expect(data.priceRecords.map((r) => r.id)).not.toContain('R010');
    await expect(page.getByTestId('hist-count')).toContainText('3');
    await expect(page.getByTestId('hist-current')).toContainText('158');
  });
});

test.describe('削除・使用停止', () => {
  test('価格履歴のある商品は削除できず、使用停止にできる（履歴は残る）', async ({ page }, info) => {
    await page.goto('/products');
    await page.getByRole('button', { name: 'やさしい麦茶を編集' }).click();
    const form = page.getByRole('form', { name: '商品の編集' });
    await expect(form.getByTestId('delete-blocked')).toContainText('価格履歴が4件あるため');
    await expect(form.getByRole('button', { name: 'この商品を削除' })).toHaveCount(0);

    page.once('dialog', (d) => d.accept());
    await form.getByRole('button', { name: '使用停止にする' }).click();
    await expect(page.getByRole('status')).toContainText('使用停止にしました');
    const data = await saved(page);
    expect(data.products.find((p) => p.id === 'P005')).toMatchObject({ archived: true });
    expect(data.priceRecords.filter((r) => r.productId === 'P005')).toHaveLength(4);

    await expect(page.getByTestId('product-list')).not.toContainText('やさしい麦茶');
    await expect(page.getByTestId('archived-products')).toContainText('使用停止中の商品（1件）');

    // 価格登録・価格比較・買い物候補から外れる
    await page.goto('/prices/new');
    await expect(page.locator('#product option[value="P005"]')).toHaveCount(0);
    await page.goto('/compare');
    await expect(compareItem(page, info, 'P005')).toHaveCount(0);
    await page.goto('/shopping');
    await expect(page.getByTestId('candidate-P005')).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByTestId('stat-products')).toContainText('4');
    // 価格履歴には残る
    await page.goto('/history?product=P005');
    await expect(page.getByTestId('hist-count')).toContainText('4');
    await expect(page.locator('body')).toContainText('使用停止中');

    // 再開
    await page.goto('/products');
    await page.getByTestId('archived-products').locator('summary').click();
    await page.getByRole('button', { name: 'やさしい麦茶を編集' }).click();
    await page.getByRole('button', { name: '使用を再開する' }).click();
    await expect(page.getByTestId('product-list')).toContainText('やさしい麦茶');
  });

  test('使用停止のキャンセルでは何も変わらない', async ({ page }) => {
    await page.goto('/stores');
    await page.getByRole('button', { name: 'コストコを編集' }).click();
    const before = await rawSaved(page);
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: '使用停止にする' }).click();
    expect(await rawSaved(page)).toBe(before);
  });

  test('価格履歴のない商品・店舗は、確認後に削除できる', async ({ page }) => {
    await page.goto('/stores');
    await page.getByRole('button', { name: 'ドラッグストアを編集' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この店舗を削除' }).click();
    await expect(page.getByRole('status')).toContainText('S005 ドラッグストア を削除しました');
    expect((await saved(page)).stores.map((s) => s.id)).not.toContain('S005');

    await page.goto('/products');
    await page.getByRole('button', { name: '＋ 商品登録' }).click();
    const add = page.getByRole('form', { name: '商品登録' });
    await add.getByLabel('カテゴリ').fill('日用品');
    await add.getByLabel('品目').fill('間違えて登録');
    await add.getByLabel('単位').fill('個');
    await add.getByRole('button', { name: '登録する' }).click();
    await page.getByRole('button', { name: '間違えて登録を編集' }).click();
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'この商品を削除' }).click();
    expect((await saved(page)).products).toHaveLength(6);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この商品を削除' }).click();
    expect((await saved(page)).products).toHaveLength(5);
    expect((await saved(page)).counters.product).toBe(6); // P006 は再利用しない
  });
});

test.describe('実運用シミュレーション', () => {
  test('バックアップ → 追加・登録・名前変更・修正 → 各画面確認 → 復元で元どおり', async ({ page }, info) => {
    // 1. 現在データをバックアップ
    const { text: backupText } = await downloadBackup(page);
    const original = JSON.parse(backupText);

    // 2. 新商品を1件追加
    await page.goto('/products');
    await page.getByRole('button', { name: '＋ 商品登録' }).click();
    const pf = page.getByRole('form', { name: '商品登録' });
    await pf.getByLabel('カテゴリ').fill('飲料');
    await pf.getByLabel('品目').fill('天然水');
    await pf.getByLabel('単位').fill('本');
    await pf.getByLabel('目安単価（円）').fill('70');
    await pf.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByTestId('product-P006')).toBeVisible();

    // 3. 新店舗を1件追加
    await page.goto('/stores');
    await page.getByRole('button', { name: '＋ 店舗追加' }).click();
    await page.getByLabel('店舗名').fill('業務スーパー');
    await page.getByRole('button', { name: '追加する' }).click();
    await expect(page.getByTestId('store-S010')).toBeVisible();

    // 4. 価格を登録（天然水 24本 1,680円 → 70円/本 = 目安と同じ）
    await page.goto('/prices/new');
    await page.locator('#product').selectOption('P006');
    await page.locator('#store').selectOption('S010');
    await page.locator('#quantity').fill('24');
    await page.locator('#price').fill('1680');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');

    // 5. 商品名を変更
    await page.goto('/products');
    await page.getByRole('button', { name: '天然水を編集' }).click();
    await page.getByRole('form', { name: '商品の編集' }).getByLabel('品目').fill('天然水 2L');
    await page.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByTestId('product-P006')).toContainText('天然水 2L');

    // 6. 店舗名を変更
    await page.goto('/stores');
    await page.getByRole('button', { name: '業務スーパーを編集' }).click();
    await page.getByRole('form', { name: '店舗の編集' }).getByLabel('店舗名').fill('業務スーパー 駅前店');
    await page.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByTestId('store-S010')).toContainText('業務スーパー 駅前店');

    // 7. 価格記録を修正（1,680円 → 1,440円 = 60円/本）
    const form = await openRecordEditor(page, 'P006', 'R011');
    await form.getByLabel('販売価格').fill('1440');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('status')).toContainText('R011 を修正しました');

    // 8. 各画面への反映
    await expect(page.getByTestId('hist-current')).toContainText('60');
    await expect(page.getByTestId('history-item').first()).toContainText('業務スーパー 駅前店');
    await page.goto('/compare');
    await expect(compareItem(page, info, 'P006')).toContainText('天然水 2L');
    await expect(compareItem(page, info, 'P006')).toContainText('業務スーパー 駅前店');
    await expect(compareItem(page, info, 'P006')).toContainText('目安より10円安い');
    await page.goto('/shopping');
    await expect(page.getByTestId('candidate-P006')).toContainText('業務スーパー 駅前店');
    await expect(page.getByTestId('candidate-count')).toHaveText('5');
    await page.goto('/');
    await expect(page.getByTestId('recent-item').first()).toContainText('天然水 2L');
    await expect(page.getByTestId('stat-products')).toContainText('6');
    await expect(page.getByTestId('stat-stores')).toContainText('10');
    await expectNoHorizontalScroll(page);

    // 9. バックアップから元の状態へ復元
    await page.goto('/settings');
    await chooseRestoreFile(page, backupText, 'shopping-price-backup.json');
    await expect(page.getByTestId('restore-preview').getByTestId('summary-products')).toContainText('6件');
    await expectNoHorizontalScroll(page);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この内容で復元する' }).click();
    await expect(page.getByRole('status')).toContainText('バックアップから復元しました');

    // 10. 元データと一致すること
    const restored = await saved(page);
    const { app: _app, exportedAt: _at, ...originalData } = original;
    expect(restored).toEqual(originalData);
    await page.reload();
    expect(await saved(page)).toEqual(originalData);
    await page.goto('/products');
    await expect(page.getByTestId('product-P006')).toHaveCount(0);
    await page.goto('/stores');
    await expect(page.getByTestId('store-S010')).toHaveCount(0);
    await page.goto('/compare');
    await expect(compareItem(page, info, 'P005')).toContainText('140');
    await page.goto('/');
    await expect(page.getByTestId('stat-shopping')).toContainText('4');
  });
});

test.describe('第3回で追加した画面状態のレイアウト', () => {
  test('データ管理・修正フォーム・使用停止欄で横スクロールが出ない', async ({ page }) => {
    const { text } = await downloadBackup(page);
    await chooseRestoreFile(page, text);
    await expect(page.getByTestId('restore-preview')).toBeVisible();
    await expectNoHorizontalScroll(page);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この内容で復元する' }).click();
    await expect(page.getByTestId('undo-card')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await openRecordEditor(page, 'P003', 'R008');
    await expectNoHorizontalScroll(page);

    await page.goto('/products');
    await page.getByRole('button', { name: 'ムシューダ クローゼット用を編集' }).click();
    await expect(page.getByRole('button', { name: '使用停止にする' })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto('/stores');
    await page.getByRole('button', { name: 'Amazonを編集' }).click();
    await expect(page.getByRole('button', { name: 'この店舗を削除' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

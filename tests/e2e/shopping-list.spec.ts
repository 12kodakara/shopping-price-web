import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// 第4回: 買い物リストの日常利用（購入済みチェック・非表示・進捗・店舗ごと・リセット）

const KEY = 'shopping-price-web/v1';

interface Saved {
  shoppingList: string[];
  purchased?: string[];
  products: { id: string; targetUnitPrice: number | null }[];
  [k: string]: unknown;
}

const saved = (page: Page): Promise<Saved> => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);

/** 保存データを書き換えてから再読み込みする（第3回までの形式のデータを再現するときなど） */
async function setSaved(page: Page, mutate: (d: Saved) => void) {
  await page.goto('/');
  const data = await saved(page);
  mutate(data);
  await page.evaluate(([key, json]) => localStorage.setItem(key, json), [KEY, JSON.stringify(data)] as const);
  await page.reload();
}

/** 第3回までの形式（purchased がない）で、買い物リストに商品を入れた状態にする */
async function legacyWithList(page: Page, ids: string[]) {
  await setSaved(page, (d) => {
    delete d.purchased;
    d.shoppingList = ids;
  });
}

const item = (page: Page, id: string) => page.getByTestId(`list-item-${id}`);
const checkbox = (page: Page, id: string) => item(page, id).getByRole('checkbox');

async function expectNoHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, '横スクロールが発生している').toBeLessThanOrEqual(cw);
}

test.describe('既存データとの互換性', () => {
  test('第3回までの保存データ（購入済みの項目なし）から正常に起動する', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await legacyWithList(page, ['P005', 'P002']);
    expect((await saved(page)).purchased).toBeUndefined(); // 読み込んだだけでは書き換えない

    await page.goto('/shopping');
    await expect(page.getByTestId('data-error')).toHaveCount(0);
    await expect(page.getByTestId('shopping-progress')).toContainText('0 / 2');
    await expect(checkbox(page, 'P005')).not.toBeChecked();
    await expect(checkbox(page, 'P002')).not.toBeChecked();
    for (const path of ['/', '/products', '/compare', '/history', '/stores', '/settings']) {
      await page.goto(path);
      await expect(page.getByTestId('data-error')).toHaveCount(0);
    }
    expect(errors).toEqual([]);

    // 最初のチェックで purchased 付きの形式で保存される
    await page.goto('/shopping');
    await checkbox(page, 'P005').check();
    const data = await saved(page);
    expect(data.purchased).toEqual(['P005']);
    expect(data.version).toBe(1);
  });
});

test.describe('購入済みチェック', () => {
  test.beforeEach(async ({ page }) => {
    await legacyWithList(page, ['P005', 'P002', 'P004']);
    await page.goto('/shopping');
  });

  test('購入済みにでき、再読み込み後も残り、未購入に戻せる', async ({ page }) => {
    await expect(page.getByTestId('shopping-progress')).toContainText('0 / 3');
    await expect(page.getByTestId('shopping-progress')).toContainText('残り3件');

    await checkbox(page, 'P002').check();
    await expect(item(page, 'P002')).toHaveClass(/is-purchased/);
    await expect(page.getByTestId('shopping-progress')).toContainText('1 / 3');
    await expect(page.getByTestId('shopping-progress')).toContainText('残り2件');
    expect((await saved(page)).purchased).toEqual(['P002']);

    await page.reload();
    await expect(checkbox(page, 'P002')).toBeChecked();
    await expect(item(page, 'P002')).toHaveClass(/is-purchased/);
    await expect(page.getByTestId('shopping-progress')).toContainText('1 / 3');

    await checkbox(page, 'P002').uncheck();
    await expect(item(page, 'P002')).not.toHaveClass(/is-purchased/);
    await expect(page.getByTestId('shopping-progress')).toContainText('0 / 3');
    expect((await saved(page)).purchased).toEqual([]);
  });

  test('チェック欄だけでなく、商品名など行のどこを押してもチェックできる', async ({ page }) => {
    await item(page, 'P004').getByText('つや姫').click();
    await expect(checkbox(page, 'P004')).toBeChecked();
    await item(page, 'P004').locator('.check-price').click();
    await expect(checkbox(page, 'P004')).not.toBeChecked();
  });

  test('店舗ごとにまとめて表示する（最安店・店舗一覧の順）', async ({ page }) => {
    const costco = page.getByTestId('store-group-S001');
    const mrmax = page.getByTestId('store-group-S009');
    await expect(costco).toContainText('コストコ');
    await expect(costco.locator('.check-item')).toHaveCount(2);
    await expect(costco).toContainText('クレラップ');
    await expect(costco).toContainText('つや姫');
    await expect(mrmax).toContainText('ミスターマックス');
    await expect(mrmax).toContainText('やさしい麦茶');
    await expect(mrmax).toContainText('140円/本');
    await expect(mrmax).toContainText('目安160円');
    // 店舗の中で買い終わると「購入済み」
    await checkbox(page, 'P005').check();
    await expect(mrmax.locator('.store-heading')).toContainText('購入済み');
    await expect(costco.locator('.store-heading')).toContainText('残り2件');
  });

  test('「購入済みを非表示」のON/OFF（設定は再読み込み後も残る）', async ({ page }) => {
    await checkbox(page, 'P005').check();
    const toggle = page.getByRole('switch', { name: '購入済みを非表示' });
    await toggle.check();
    await expect(item(page, 'P005')).toHaveCount(0);
    await expect(page.getByTestId('store-group-S009')).toHaveCount(0); // 空になった店舗は見出しごと隠す
    await expect(item(page, 'P002')).toBeVisible();
    await expect(page.getByTestId('hidden-note')).toContainText('購入済み1件を非表示');
    await expect(page.getByTestId('shopping-progress')).toContainText('1 / 3'); // 進捗は全体で数える

    await page.reload();
    await expect(page.getByRole('switch', { name: '購入済みを非表示' })).toBeChecked();
    await expect(item(page, 'P005')).toHaveCount(0);

    await page.getByRole('switch', { name: '購入済みを非表示' }).uncheck();
    await expect(item(page, 'P005')).toBeVisible();
    await expect(checkbox(page, 'P005')).toBeChecked();
  });

  test('全部買うと「買い物完了」。非表示ONでも崩れない', async ({ page }) => {
    for (const id of ['P005', 'P002', 'P004']) await checkbox(page, id).check();
    await expect(page.getByTestId('shopping-complete')).toContainText('買い物完了');
    await expect(page.getByTestId('shopping-complete')).toContainText('3件すべて購入済み');
    await expect(page.getByTestId('shopping-progress')).toContainText('3 / 3');
    // 下の方の商品をチェックして終えても分かるよう、上に残る進捗欄にも完了を出す
    await expect(page.getByTestId('shopping-progress')).toContainText('買い物完了');

    await page.getByRole('switch', { name: '購入済みを非表示' }).check();
    await expect(page.getByTestId('shopping-complete')).toBeVisible();
    await expect(page.locator('.check-item')).toHaveCount(0);
    await expect(page.getByTestId('hidden-note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'すべて未購入に戻す' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('「すべて未購入に戻す」は確認ダイアログを出し、キャンセルなら何もしない', async ({ page }) => {
    await checkbox(page, 'P005').check();
    await checkbox(page, 'P002').check();

    await page.getByRole('button', { name: 'すべて未購入に戻す' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('すべての商品を未購入に戻しますか？');
    await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused(); // 誤操作防止
    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect(dialog).toBeHidden();
    expect((await saved(page)).purchased).toEqual(['P005', 'P002']);

    await page.getByRole('button', { name: 'すべて未購入に戻す' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '未購入に戻す' }).click();
    await expect(page.getByRole('status')).toContainText('すべて未購入に戻しました');
    await expect(page.getByTestId('shopping-progress')).toContainText('0 / 3');
    const data = await saved(page);
    expect(data.purchased).toEqual([]);
    expect(data.shoppingList).toEqual(['P005', 'P002', 'P004']); // リストの中身は残る
    await expect(page.getByRole('button', { name: 'すべて未購入に戻す' })).toHaveCount(0);
  });

  test('「今回買う」を外すと、リストからも購入済みからも外れる', async ({ page }) => {
    await checkbox(page, 'P005').check();
    await page.getByTestId('candidate-P005').getByRole('button', { name: /今回買う/ }).click();
    await expect(item(page, 'P005')).toHaveCount(0);
    await expect(page.getByTestId('shopping-progress')).toContainText('0 / 2');
    const data = await saved(page);
    expect(data.shoppingList).toEqual(['P002', 'P004']);
    expect(data.purchased).toEqual([]);
  });
});

test.describe('空の状態・特殊な商品', () => {
  test('リストが空のときは案内を出し、候補をまとめて入れられる', async ({ page }) => {
    await page.goto('/shopping');
    await expect(page.getByTestId('shopping-list-empty')).toContainText('買い物リストは空です');
    await expect(page.getByTestId('shopping-progress')).toHaveCount(0);
    await page.getByRole('button', { name: '候補4件をすべてリストに入れる' }).click();
    await expect(page.getByTestId('shopping-progress')).toContainText('0 / 4');
    await expect(page.getByTestId('selected-count')).toHaveText('4');
    expect((await saved(page)).shoppingList).toEqual(['P005', 'P002', 'P004', 'P003']);
  });

  test('買い物候補が0件でも表示が崩れない', async ({ page }) => {
    await setSaved(page, (d) => {
      for (const p of d.products) p.targetUnitPrice = 1; // すべて目安超え
    });
    await page.goto('/shopping');
    await expect(page.getByTestId('no-candidates')).toContainText('目安単価以下の商品はまだありません');
    await expect(page.getByTestId('candidate-count')).toHaveText('0');
    await expect(page.getByTestId('shopping-list-empty')).toBeVisible();
    await expect(page.getByRole('button', { name: /すべてリストに入れる/ })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test('価格の記録がない商品は「店舗未定」にまとめ、リストから外せる', async ({ page }) => {
    await setSaved(page, (d) => {
      (d.products as unknown[]).push({ id: 'P006', category: '日用品', name: 'ティッシュ', unitAmount: 1, unit: '箱', targetUnitPrice: null });
      (d.counters as { product: number }).product = 6;
      d.shoppingList = ['P006', 'P005'];
    });
    await page.goto('/shopping');
    const none = page.getByTestId('store-group-none');
    await expect(none).toContainText('店舗未定');
    await expect(none).toContainText('ティッシュ');
    await expect(none).toContainText('価格未登録');
    // 店舗未定は最後
    await expect(page.locator('.store-group').last()).toHaveAttribute('data-testid', 'store-group-none');
    await checkbox(page, 'P006').check();
    await expect(page.getByTestId('shopping-progress')).toContainText('1 / 2');
    await page.getByRole('button', { name: 'ティッシュをリストから外す' }).click();
    await expect(none).toHaveCount(0);
    const data = await saved(page);
    expect(data.shoppingList).toEqual(['P005']);
    expect(data.purchased).toEqual([]);
  });

  test('リストに入れた後に値上がりした商品は「目安超え」と表示して残す', async ({ page }) => {
    await legacyWithList(page, ['P001']); // サランラップ 433円（目安430円）
    await page.goto('/shopping');
    await expect(item(page, 'P001')).toContainText('目安超え');
    await expect(item(page, 'P001')).toContainText('433円/本');
    await expect(page.getByTestId('store-group-S001')).toContainText('コストコ');
  });
});

test.describe('バックアップ・復元', () => {
  test('購入済みの状態もバックアップされ、復元で戻る', async ({ page }) => {
    await legacyWithList(page, ['P005', 'P002']);
    await page.goto('/shopping');
    await checkbox(page, 'P002').check();

    await page.goto('/settings');
    await expect(page.getByTestId('storage-summary')).toContainText('買い物リスト2件（購入済み 1）');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
    const text = readFileSync(await download.path(), 'utf-8');
    const json = JSON.parse(text);
    expect(json.version).toBe(1);
    expect(json.shoppingList).toEqual(['P005', 'P002']);
    expect(json.purchased).toEqual(['P002']);

    // すべて未購入に戻してから復元
    await page.goto('/shopping');
    await page.getByRole('button', { name: 'すべて未購入に戻す' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '未購入に戻す' }).click();
    await expect(checkbox(page, 'P002')).not.toBeChecked();

    await page.goto('/settings');
    await page.locator('#restore-file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.getByTestId('restore-preview')).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この内容で復元する' }).click();
    await expect(page.getByRole('status')).toContainText('バックアップから復元しました');

    await page.goto('/shopping');
    await expect(checkbox(page, 'P002')).toBeChecked();
    await expect(page.getByTestId('shopping-progress')).toContainText('1 / 2');
  });

  test('第3回の形式のバックアップ（購入済みなし）も復元できる', async ({ page }) => {
    await page.goto('/settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
    const json = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    delete json.purchased;
    json.shoppingList = ['P005'];
    await page.locator('#restore-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    await expect(page.getByTestId('restore-preview').getByTestId('summary-shoppingList')).toContainText('1件');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この内容で復元する' }).click();
    await page.goto('/shopping');
    await expect(page.getByTestId('shopping-progress')).toContainText('0 / 1');
    expect((await saved(page)).purchased).toEqual([]);
  });

  test('不正な購入済み情報を含むバックアップは拒否する', async ({ page }) => {
    await page.goto('/settings');
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
    const json = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    json.purchased = ['P999'];
    await page.locator('#restore-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    await expect(page.getByTestId('restore-error')).toContainText('購入済みの商品「P999」が商品データにありません');
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
  });
});

test.describe('片手操作・レイアウト', () => {
  test('チェック行が押しやすい大きさで、横スクロールも下部ナビとの重なりもない', async ({ page }, info) => {
    await legacyWithList(page, ['P005', 'P002', 'P004', 'P003', 'P001']);
    await page.goto('/shopping');
    await expectNoHorizontalScroll(page);

    // 行の高さ・チェック欄の大きさ
    const row = await item(page, 'P005').locator('.check-row').boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(56);
    const box = await checkbox(page, 'P005').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(28);
    // 行は画面幅いっぱい近くまで押せる
    const vw = page.viewportSize()!.width;
    if (info.project.name === 'smartphone') expect(row!.width).toBeGreaterThan(vw * 0.8);

    // 商品名・価格・店舗名が見える
    await expect(item(page, 'P003')).toContainText('ムシューダ クローゼット用');
    await expect(item(page, 'P003')).toContainText('199.8円/個');
    await expect(page.getByTestId('store-group-S001').locator('.store-heading')).toContainText('コストコ');

    if (info.project.name === 'smartphone') {
      // いちばん下までスクロールしたとき、最後の行が下部ナビに隠れずに押せる
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = page.locator('.check-item').last();
      const nav = await page.getByTestId('bottom-nav').boundingBox();
      const lastRow = await last.boundingBox();
      expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(nav!.y);
      await last.locator('.check-name').click();
      await expect(last.getByRole('checkbox')).toBeChecked();

      // 進捗と「購入済みを非表示」はスクロールしても上に残る
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect(page.getByTestId('shopping-progress')).toBeInViewport();
      await expect(page.getByRole('switch', { name: '購入済みを非表示' })).toBeInViewport();
      // 進捗とスイッチは1行に並ぶ（状態によって高さが変わらない）
      const p = await page.getByTestId('shopping-progress').boundingBox();
      const sw = await page.locator('.switch').boundingBox();
      expect(Math.abs(p!.y - sw!.y)).toBeLessThan(24);
    }
  });
});

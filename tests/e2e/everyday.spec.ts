import { expect, test, type Page } from '@playwright/test';
import { choose } from '../fixtures/combobox';

// 第16回: 普段使いの改善（価格登録・買い物リスト・使用停止欄の回帰確認）。
// サンプルデータ（テストごとに新しいブラウザで作られる）だけを使う。本番データ・クラウドには触れない。

const KEY = 'shopping-price-web/v1';

interface Saved {
  priceRecords: { id: string; productId: string; storeId: string; price: number; quantity: number }[];
  shoppingList: string[];
  [k: string]: unknown;
}

const saved = (page: Page): Promise<Saved> => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);

test.describe('価格登録（店頭での使いやすさ）', () => {
  test('最近使ったお店を1タップで選べ、同じ店の前回の値札が見える', async ({ page }) => {
    await page.goto('/prices/new');
    const recent = page.getByTestId('recent-stores');
    await expect(recent).toBeVisible();
    // いちばん新しく登録したお店が先頭
    await expect(recent.getByRole('button').first()).toHaveText('ミスターマックス');

    await choose(page, 'product', 'P005');
    await page.getByTestId('recent-store-S009').click();
    await expect(page.locator('#store')).toHaveAttribute('data-value', 'S009');
    await expect(page.getByTestId('recent-store-S009')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('same-store-previous')).toHaveText('この店の前回：840円／6本（9/22）');

    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('820');
    // ふつうの値動きでは注意は出ない
    await expect(page.getByTestId('price-warning')).toHaveCount(0);
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');

    const data = await saved(page);
    expect(data.priceRecords).toHaveLength(11);
    expect(data.priceRecords.at(-1)).toMatchObject({ productId: 'P005', storeId: 'S009', quantity: 6, price: 820 });
    // 続けて登録しやすいよう、お店は選んだまま
    await expect(page.locator('#store')).toHaveAttribute('data-value', 'S009');
  });

  test('★いつもと大きく違う単価は確認し、キャンセルなら登録しない', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'product', 'P005');
    await page.getByTestId('recent-store-S009').click();
    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('8400'); // 840円の打ち間違い

    const warning = page.getByTestId('price-warning');
    await expect(warning).toContainText('この店の前回（140円/本）の約10倍');

    // キャンセル → 何も保存しない
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.dismiss();
    });
    await page.getByRole('button', { name: '登録する' }).click();
    await expect.poll(() => message).toContain('このまま登録しますか');
    expect((await saved(page)).priceRecords).toHaveLength(10);
    await expect(page.locator('#price')).toHaveValue('8400');

    // 本当にその価格なら、確認して登録できる（登録するかどうかは利用者が決める）
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
    expect((await saved(page)).priceRecords.at(-1)).toMatchObject({ price: 8400 });
  });

  test('小数の価格・数字でない値は、理由を表示して登録しない', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'product', 'P005');
    await choose(page, 'store', 'S009');
    await page.locator('#quantity').fill('6');

    await page.locator('#price').fill('99.5');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.locator('#price-error')).toContainText('1円単位');

    await page.locator('#price').fill('Infinity');
    await expect(page.locator('#price-error')).toContainText('数字で入力してください');

    await page.locator('#price').fill('2000000');
    await expect(page.locator('#price-error')).toContainText('大きすぎます');

    expect((await saved(page)).priceRecords).toHaveLength(10);
  });
});

test.describe('価格登録の境界値', () => {
  test('1円・上限ちょうどは登録でき、上限+1円・数量0 は登録できない', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'product', 'P003');
    await choose(page, 'store', 'S001');

    // 数量0
    await page.locator('#quantity').fill('0');
    await page.locator('#price').fill('100');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.locator('#quantity-error')).toContainText('1以上の整数');
    // 上限+1円
    await page.locator('#quantity').fill('1');
    await page.locator('#price').fill('1000001');
    await expect(page.locator('#price-error')).toContainText('大きすぎます');
    expect((await saved(page)).priceRecords).toHaveLength(10);

    // 上限ちょうど（いつもの単価と大きく違うので確認が出る → 承認すれば登録できる）
    await page.locator('#price').fill('1000000');
    await expect(page.locator('#price-error')).toHaveCount(0);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
    expect((await saved(page)).priceRecords.at(-1)).toMatchObject({ productId: 'P003', price: 1000000, quantity: 1 });

    // 1円（同じく確認を承認して登録）
    await page.waitForTimeout(1600); // 連続登録の二重クリック防止（1.5秒）を待つ
    await choose(page, 'product', 'P003');
    await page.locator('#quantity').fill('1');
    await page.locator('#price').fill('1');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: '登録する' }).click();
    await expect.poll(async () => (await saved(page)).priceRecords.length).toBe(12);
    expect((await saved(page)).priceRecords.at(-1)).toMatchObject({ price: 1, quantity: 1 });
  });
});

test.describe('価格記録の修正・削除', () => {
  test('★修正画面でも、いつもと大きく違う単価は確認する（キャンセルなら変えない）', async ({ page }) => {
    await page.goto('/history?product=P005&edit=R010');
    const form = page.getByRole('form', { name: '価格記録の修正' });
    await expect(form).toContainText('R010');
    // 修正前の値（840円）では注意は出ない
    await expect(form.getByTestId('record-price-warning')).toHaveCount(0);

    await form.getByLabel('販売価格').fill('8400');
    // 修正前の自分自身ではなく、同じ店のほかの記録（R001: 150円/本）と比べる
    await expect(form.getByTestId('record-price-warning')).toContainText('この店の前回（150円/本）');

    page.once('dialog', (d) => void d.dismiss());
    await form.getByRole('button', { name: '更新する' }).click();
    expect((await saved(page)).priceRecords.find((r) => r.id === 'R010')).toMatchObject({ price: 840 });

    page.once('dialog', (d) => void d.accept());
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('status')).toContainText('R010 を修正しました');
    expect((await saved(page)).priceRecords.find((r) => r.id === 'R010')).toMatchObject({ price: 8400 });
  });

  test('★価格記録を削除すると、最安・前回価格・件数・買い物候補がすべて再計算される', async ({ page }) => {
    // 削除前：やさしい麦茶の最安はミスターマックスの R010（840円/6本 = 140円/本）
    await page.goto('/prices/new?product=P005');
    await expect(page.getByTestId('price-result')).toContainText('現在の最安：140円/本（ミスターマックス）');

    await page.goto('/history?product=P005&edit=R010');
    const form = page.getByRole('form', { name: '価格記録の修正' });
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.accept();
    });
    await form.getByRole('button', { name: 'この記録を削除' }).click();
    await expect(page.getByRole('status')).toContainText('R010 を削除しました');
    // 削除前の確認には、日付・商品・店舗・内容・記録ID・元に戻せないことが出る
    for (const text of ['2026-09-22', 'やさしい麦茶', 'ミスターマックス', '6本 840円', 'R010', '元に戻せません']) expect(message).toContain(text);

    // 件数
    await expect(page.getByTestId('hist-count')).toContainText('3');
    const data = await saved(page);
    expect(data.priceRecords.map((r) => r.id)).not.toContain('R010');

    // 価格登録：最安と「この店の前回」は、残っている記録（R001: 900円/6本 = 150円/本）になる
    await page.goto('/prices/new?product=P005');
    await choose(page, 'store', 'S009');
    await expect(page.getByTestId('price-result')).toContainText('現在の最安：150円/本（ミスターマックス）');
    await expect(page.getByTestId('same-store-previous')).toHaveText('この店の前回：900円／6本（8/30）');

    // 買い物候補：最安単価が150円（目安160円より10円安い）に変わる
    await page.goto('/shopping');
    const card = page.getByTestId('candidate-P005');
    await expect(card).toContainText('150');
    await expect(card).toContainText('目安より10円安い');
  });
});

test.describe('買い物リスト（お店で見る情報）', () => {
  test('買う物・お店・値札・いくら以下なら買いかが一目で分かる', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((key) => {
      const d = JSON.parse(localStorage.getItem(key)!);
      d.shoppingList = ['P005'];
      localStorage.setItem(key, JSON.stringify(d));
    }, KEY);
    await page.goto('/shopping');

    const group = page.getByTestId('store-group-S009');
    await expect(group).toContainText('ミスターマックス');
    await expect(group).toContainText('やさしい麦茶');
    await expect(group).toContainText('140円/本');
    await expect(page.getByTestId('shelf-P005')).toHaveText('前回 840円／6本・960円以下なら目安どおり');

    // 購入済みにできる（今までどおり）
    await page.getByTestId('list-item-P005').locator('.check-row').click();
    await expect(page.getByTestId('shopping-progress')).toContainText('1 / 1');
  });
});

test.describe('使用停止・削除・更新の見分け（回帰確認）', () => {
  test('更新は主ボタン、使用停止は注意色、削除は赤で区別できる', async ({ page }) => {
    const colors = (page: Page, name: string) =>
      page.getByRole('button', { name, exact: true }).evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color };
      });

    // 価格履歴のない店舗（ドラッグストア）なら、3つとも並ぶ
    await page.goto('/stores');
    await page.getByRole('button', { name: 'ドラッグストアを編集' }).click();
    const update = await colors(page, '更新する');
    const archive = await colors(page, '使用停止にする');
    const remove = await colors(page, 'この店舗を削除');

    expect(update.bg).toBe('rgb(31, 111, 92)'); // 主ボタン（緑）
    expect(archive.bg).toBe('rgb(255, 246, 224)'); // 薄い注意色
    expect(remove.color).toBe('rgb(179, 38, 30)'); // 赤
    expect(new Set([update.bg, archive.bg, remove.bg]).size).toBe(3);
  });
});

// 第16回 追加修正：販売数量は「1本」「6本」のような個数。小数は入力ミスとして扱う
test.describe('販売数量は1以上の整数だけ', () => {
  test('★小数（1.5）はエラーになり、単価も出ず、確認ダイアログも出ず、登録もされない', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'product', 'P005');
    await choose(page, 'store', 'S009');
    await page.locator('#quantity').fill('1.5');
    await page.locator('#price').fill('840');

    // 単価は出さない（840 ÷ 1.5 = 560円/本 をもっともらしく見せない）
    await expect(page.getByTestId('price-result')).toContainText('販売数量と販売価格を入力すると単価を計算します');
    await expect(page.getByTestId('price-result')).not.toContainText('560');

    // 確認ダイアログが出たらテストを失敗させる（出ないことの確認）
    let dialogShown = false;
    page.on('dialog', (d) => {
      dialogShown = true;
      void d.dismiss();
    });

    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.locator('#quantity-error')).toContainText('販売数量は1以上の整数を入力してください');
    await expect(page.getByRole('status')).toContainText('未入力または正しくない項目があります：販売数量');
    expect(dialogShown).toBe(false);
    expect((await saved(page)).priceRecords).toHaveLength(10);
  });

  test('★6（整数）なら単価140円/本で登録できる', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'product', 'P005');
    await choose(page, 'store', 'S009');
    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('840');
    await expect(page.getByTestId('price-result')).toContainText('140');

    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
    const records = (await saved(page)).priceRecords;
    expect(records).toHaveLength(11);
    expect(records[records.length - 1]).toMatchObject({ quantity: 6, price: 840 });
  });

  test('0・マイナスも同じ案内になる', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'product', 'P005');
    await choose(page, 'store', 'S009');
    await page.locator('#price').fill('840');

    for (const bad of ['0', '-1', '0.5', '2.3']) {
      await page.locator('#quantity').fill(bad);
      await page.getByRole('button', { name: '登録する' }).click();
      await expect(page.locator('#quantity-error')).toContainText('販売数量は1以上の整数を入力してください');
    }
    expect((await saved(page)).priceRecords).toHaveLength(10);
  });

  test('★価格履歴の修正でも小数にはできない（元の記録はそのまま）', async ({ page }) => {
    await page.goto('/history?product=P005');
    await page.getByRole('button', { name: /（R010）を修正/ }).click();
    const form = page.getByRole('form', { name: '価格記録の修正' });
    await expect(form).toBeVisible();

    const before = (await saved(page)).priceRecords.find((r) => r.id === 'R010');
    await form.locator('#rec-quantity').fill('1.5');
    await expect(page.getByTestId('record-editor-unit-price')).toContainText('—');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.locator('#rec-quantity-error')).toContainText('販売数量は1以上の整数を入力してください');

    // 保存データは変わっていない
    const after = (await saved(page)).priceRecords.find((r) => r.id === 'R010');
    expect(after).toEqual(before);
  });
});

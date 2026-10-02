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

    // 候補にも、最安店の値札が出る
    await expect(page.getByTestId('candidate-shelf-P002')).toHaveText('1,698円／4本');

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

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { choose } from '../fixtures/combobox';

// 第9回: スマホ実機フィードバック（重複タイトル・検索付き選択・買い物候補カード・買い物リスト上部）

const KEY = 'shopping-price-web/v1';
const isSp = (info: TestInfo) => info.project.name === 'smartphone';
const saved = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);

async function expectNoHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, '横スクロールが発生している').toBeLessThanOrEqual(cw);
}

/** 上部ヘッダーと本文に見えている、ちょうどその文字の要素の数（下部ナビのボタン名は数えない） */
async function visibleExactText(page: Page, text: string) {
  return page.locator('.topbar, main').getByText(text, { exact: true }).evaluateAll((els) =>
    els.filter((e) => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none';
    }).length,
  );
}

test.describe('画面名の重複', () => {
  for (const [path, title] of [['/compare', '価格比較'], ['/prices/new', '価格登録'], ['/shopping', '買い物候補'], ['/products', '商品'], ['/history', '価格履歴']]) {
    test(`${title}: スマホは緑ヘッダーだけ、PCは本文の見出し`, async ({ page }, info) => {
      await page.goto(path);
      const h1 = page.getByRole('heading', { level: 1, name: title });
      // 見出しとしては残っている（読み上げ用）
      await expect(h1).toHaveCount(1);
      const box = (await h1.boundingBox())!;
      if (isSp(info)) {
        await expect(page.locator('.topbar-title')).toHaveText(title);
        expect(box.height).toBeLessThanOrEqual(1);
        expect(await visibleExactText(page, title)).toBe(1);
      } else {
        await expect(page.locator('.topbar')).toBeHidden();
        expect(box.height).toBeGreaterThan(20);
      }
    });
  }
});

test.describe('価格登録: 商品の検索付き選択', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/prices/new');
  });

  const options = (page: Page, id: 'product' | 'store') => page.getByTestId(`${id}-combobox`).getByRole('option');

  test('タップで候補を表示し、商品名・商品IDで絞り込める', async ({ page }) => {
    const input = page.getByRole('combobox', { name: /商品/ });
    await input.click();
    await expect(options(page, 'product')).toHaveCount(5);
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    await input.fill('ラップ');
    await expect(options(page, 'product')).toHaveCount(2);
    await input.fill('p004'); // 商品ID（英字の大小は区別しない）
    await expect(options(page, 'product')).toHaveCount(1);
    await expect(options(page, 'product').first()).toContainText('つや姫');
    await input.fill('  麦茶 ');
    await expect(options(page, 'product')).toHaveCount(1);
  });

  test('候補が0件なら「該当する商品がありません」', async ({ page }) => {
    const input = page.locator('#product');
    await input.click();
    await input.fill('牛乳');
    await expect(options(page, 'product')).toHaveCount(0);
    await expect(page.getByTestId('product-combobox')).toContainText('該当する商品がありません');
  });

  test('候補を押すと決まり、選んだ内容が表示され、選び直せる', async ({ page }) => {
    const input = page.locator('#product');
    await input.click();
    await input.fill('つや');
    await options(page, 'product').first().click();
    await expect(input).toHaveValue('つや姫（P004）');
    await expect(input).toHaveAttribute('data-value', 'P004');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('price-result')).toContainText('つや姫');
    // 単位が選んだ商品のものになる
    await expect(page.locator('.affix').first()).toHaveText('kg');

    // 選び直し
    await input.click();
    await expect(options(page, 'product')).toHaveCount(5);
    await expect(page.getByTestId('product-combobox').locator('[aria-selected="true"]')).toContainText('つや姫');
    await input.fill('麦茶');
    await options(page, 'product').first().click();
    await expect(input).toHaveAttribute('data-value', 'P005');
    await expect(input).toHaveValue('やさしい麦茶（P005）');
    await expect(page.locator('.affix').first()).toHaveText('本');
  });

  test('キーボードでも選べる（↓・Enter）、Esc で閉じても選択は変わらない', async ({ page }) => {
    const input = page.locator('#product');
    await input.focus();
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.type('クレ');
    await page.keyboard.press('Enter');
    await expect(input).toHaveAttribute('data-value', 'P002');
    await input.click();
    await page.keyboard.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).toHaveAttribute('data-value', 'P002');
  });

  test('店舗: 店舗名で絞り込み・0件・選択・選び直し（英字の大小は区別しない）', async ({ page }) => {
    const input = page.getByRole('combobox', { name: /店舗/ });
    await input.click();
    await expect(options(page, 'store')).toHaveCount(9);
    await input.fill('AMAZON');
    await expect(options(page, 'store')).toHaveCount(1);
    await options(page, 'store').first().click();
    await expect(input).toHaveAttribute('data-value', 'S007');
    await expect(input).toHaveValue('Amazon（S007）');

    await input.click();
    await input.fill('業務スーパー');
    await expect(page.getByTestId('store-combobox')).toContainText('該当する店舗がありません');
    await input.fill('ドン');
    await options(page, 'store').first().click();
    await expect(input).toHaveAttribute('data-value', 'S003');
  });

  test('選んだ商品・店舗はIDで保存され、計算と登録はこれまでどおり', async ({ page }) => {
    await choose(page, 'product', 'P005');
    await choose(page, 'store', 'S009');
    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('840');
    const result = page.getByTestId('price-result');
    await expect(result).toContainText('1本あたり');
    await expect(result).toContainText('140');
    await expect(result).toContainText('160');
    await expect(page.getByTestId('result-verdict')).toContainText('目安より20円安い');
    await expect(result).toContainText('現在の最安：140円/本（ミスターマックス）');
    await page.getByLabel('セール価格（任意）').check();
    await page.getByLabel('備考（任意）').fill('テスト');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
    const rec = (await saved(page)).priceRecords.at(-1);
    expect(rec).toMatchObject({ productId: 'P005', storeId: 'S009', quantity: 6, price: 840, sale: true, note: 'テスト' });
    // 続けて登録しやすいよう、店舗は残り、商品は空に戻る
    await expect(page.locator('#store')).toHaveAttribute('data-value', 'S009');
    await expect(page.locator('#product')).toHaveAttribute('data-value', '');
    await expect(page.locator('#product')).toHaveValue('');
  });

  test('使用停止の商品・店舗は候補に出ない', async ({ page }) => {
    await page.evaluate((key) => {
      const d = JSON.parse(localStorage.getItem(key)!);
      d.products.find((p: { id: string }) => p.id === 'P002').archived = true;
      d.stores.find((s: { id: string }) => s.id === 'S008').archived = true;
      localStorage.setItem(key, JSON.stringify(d));
    }, KEY);
    await page.reload();
    await page.locator('#product').click();
    await expect(options(page, 'product')).toHaveCount(4);
    // 商品の候補を開いたまま店舗欄を押しても、店舗の候補が開く
    await page.locator('#store').click();
    await expect(options(page, 'store')).toHaveCount(8);
    await expect(page.getByTestId('product-combobox').getByRole('listbox')).toHaveCount(0);
  });

  test('スマホ: 開くと入力欄が画面の上の方へ移動し、候補は画面内に収まる', async ({ page }, info) => {
    test.skip(!isSp(info), 'スマホのみ');
    await page.locator('#store').click();
    await expect(page.getByTestId('store-combobox').getByRole('listbox')).toBeVisible();
    await expect.poll(async () => (await page.locator('#store').boundingBox())!.y).toBeLessThan(140);
    // 項目名「店舗」は上部ヘッダー（高さ52px）に隠れていない
    const label = (await page.locator('label[for="store"]').boundingBox())!;
    expect(label.y).toBeGreaterThanOrEqual(52);
    const list = (await page.getByTestId('store-combobox').getByRole('listbox').boundingBox())!;
    expect(list.height).toBeLessThanOrEqual(740 * 0.45 + 2);
    // 候補は押しやすい高さ
    const opt = (await options(page, 'store').first().boundingBox())!;
    expect(opt.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
  });

  test('商品が多くても候補は50件まで表示し、残りは入力で絞り込む', async ({ page }) => {
    await page.evaluate((key) => {
      const d = JSON.parse(localStorage.getItem(key)!);
      for (let i = 6; i <= 130; i++) {
        d.products.push({ id: `P${String(i).padStart(3, '0')}`, category: 'テスト', name: `テスト商品 ${i}`, unitAmount: 1, unit: '個', targetUnitPrice: null });
      }
      d.counters.product = 130;
      localStorage.setItem(key, JSON.stringify(d));
    }, KEY);
    await page.reload();
    await page.locator('#product').click();
    await expect(options(page, 'product')).toHaveCount(50);
    await expect(page.getByTestId('product-combobox')).toContainText('ほか80件');
    await page.locator('#product').fill('P130');
    await expect(options(page, 'product')).toHaveCount(1);
  });
});

test.describe('買い物候補カード', () => {
  test('「今回買う」が主な操作で、押すと追加済みの表示に変わる。「価格を登録」も使える', async ({ page }) => {
    await page.goto('/shopping');
    const card = page.getByTestId('candidate-P005');
    const buy = card.getByRole('button', { name: /今回買う/ });
    await expect(buy).toHaveText('＋ 今回買う');
    await expect(buy).toHaveClass(/button-primary/);
    const register = card.getByRole('link', { name: '価格を登録' });
    await expect(register).toHaveClass(/button-ghost/);
    // 主な操作の方が幅が広い
    expect((await buy.boundingBox())!.width).toBeGreaterThan((await register.boundingBox())!.width);

    await buy.click();
    await expect(buy).toHaveText('✓ 今回買う');
    await expect(buy).toHaveAttribute('aria-pressed', 'true');
    await expect(buy).toHaveClass(/button-added/);
    await expect(page.getByTestId('list-item-P005')).toBeVisible();

    await register.click();
    await expect(page).toHaveURL(/\/prices\/new\?product=P005$/);
    await expect(page.locator('#product')).toHaveAttribute('data-value', 'P005');
    await expect(page.locator('#product')).toHaveValue('やさしい麦茶（P005）');
  });

  test('スマホではコンパクト（情報は同じ）', async ({ page }, info) => {
    await page.goto('/shopping');
    const card = page.getByTestId('candidate-P005');
    for (const text of ['やさしい麦茶', '飲料', '最安店', 'ミスターマックス', '最安単価', '140', '目安単価', '160', '目安より20円安い', '過去最安']) {
      await expect(card).toContainText(text);
    }
    const h = (await card.boundingBox())!.height;
    if (isSp(info)) expect(h).toBeLessThan(215); // 変更前 280px
    await expectNoHorizontalScroll(page);
  });
});

test.describe('買い物リストの上部', () => {
  test('スマホで開いた直後に買い物リストが早く見える。進捗と「購入済みを非表示」は維持', async ({ page }, info) => {
    await page.goto('/');
    await page.evaluate((key) => {
      const d = JSON.parse(localStorage.getItem(key)!);
      d.shoppingList = ['P005', 'P002', 'P004', 'P003'];
      localStorage.setItem(key, JSON.stringify(d));
    }, KEY);
    await page.goto('/shopping');
    const progress = page.getByTestId('shopping-progress');
    await expect(progress).toContainText('0 / 4 購入済み');
    await expect(progress).toContainText('残り4件');
    // 文字を小さくして押し込んでいない
    const fontSize = await progress.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(14);
    await expect(page.getByRole('switch', { name: '購入済みを非表示' })).toBeVisible();

    const firstItem = (await page.locator('.check-item').first().boundingBox())!;
    if (isSp(info)) expect(firstItem.y).toBeLessThan(290); // 変更前 334px

    // 店舗グループ・大きなチェック・購入済み・非表示はこれまでどおり
    await expect(page.getByTestId('store-group-S001')).toContainText('残り3件');
    const check = page.getByTestId('list-item-P005').getByRole('checkbox');
    expect((await check.boundingBox())!.width).toBeGreaterThanOrEqual(28);
    await check.check();
    await expect(progress).toContainText('1 / 4 購入済み');
    await page.getByRole('switch', { name: '購入済みを非表示' }).check();
    await expect(page.getByTestId('list-item-P005')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

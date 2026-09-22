import { expect, test, type Page } from '@playwright/test';

// 第5回: 商品・店舗・価格履歴の検索／絞り込み

const KEY = 'shopping-price-web/v1';

async function expectNoHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, '横スクロールが発生している').toBeLessThanOrEqual(cw);
}

/** 保存データを直接書き換えて再読み込みする（使用停止の商品・店舗や英字の店舗名を用意する） */
async function setSaved(page: Page, mutate: (d: Record<string, unknown>) => void) {
  await page.goto('/');
  const data = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
  mutate(data);
  await page.evaluate(([key, json]) => localStorage.setItem(key, json), [KEY, JSON.stringify(data)] as const);
  await page.reload();
}

const rawSaved = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

const productCards = (page: Page) => page.getByTestId('product-list').locator('> li');
const storeRows = (page: Page) => page.getByTestId('store-list').locator('> li');
const recordRows = (page: Page) => page.getByTestId('history-list').locator('> li');

test.describe('商品の検索', () => {
  test('入力と同時に部分一致で絞り込み、件数を表示する', async ({ page }) => {
    await page.goto('/products');
    await expect(page.getByTestId('product-count')).toHaveText('5件');
    await expect(page.getByRole('button', { name: 'クリア', exact: true })).toHaveCount(0);

    const search = page.getByRole('searchbox', { name: '商品を検索' });
    await search.fill('ラップ');
    await expect(productCards(page)).toHaveCount(2);
    await expect(page.getByTestId('product-list')).toContainText('サランラップ');
    await expect(page.getByTestId('product-list')).toContainText('クレラップ');
    await expect(page.getByTestId('product-count')).toHaveText('2 / 5件');

    // カテゴリでも探せる
    await search.fill('飲料');
    await expect(productCards(page)).toHaveCount(1);
    await expect(page.getByTestId('product-list')).toContainText('やさしい麦茶');

    // 日本語の一部だけ
    await search.fill('麦');
    await expect(productCards(page)).toHaveCount(1);
  });

  test('前後の空白・英字の大文字小文字・全角英字を区別しない', async ({ page }) => {
    await page.goto('/products');
    const search = page.getByRole('searchbox', { name: '商品を検索' });
    await search.fill('   つや姫   ');
    await expect(productCards(page)).toHaveCount(1);
    await expect(page.getByTestId('product-list')).toContainText('つや姫');
    await search.fill('30CM'); // メモ「30cm×50m」
    await expect(productCards(page)).toHaveCount(2);
    await search.fill('３０ｃｍ');
    await expect(productCards(page)).toHaveCount(2);
  });

  test('0件のときは「該当する商品がありません」と表示し、クリアで戻る', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('牛乳');
    await expect(page.getByTestId('product-no-match')).toContainText('該当する商品がありません');
    await expect(page.getByTestId('product-list')).toHaveCount(0);
    await expect(page.getByTestId('product-empty')).toHaveCount(0); // 未登録の空状態とは別
    await expect(page.getByTestId('product-count')).toHaveText('0 / 5件');
    await page.getByTestId('product-no-match').getByRole('button', { name: '検索条件をクリア' }).click();
    await expect(page.getByRole('searchbox', { name: '商品を検索' })).toHaveValue('');
    await expect(productCards(page)).toHaveCount(5);
  });

  test('使用中／使用停止／すべて を切り替えられ、クリアで使用中に戻る', async ({ page }) => {
    await setSaved(page, (d) => {
      const products = d.products as { id: string; archived?: boolean }[];
      products.find((p) => p.id === 'P002')!.archived = true;
    });
    await page.goto('/products');
    // 既定は使用中（使用停止中は従来どおり折りたたみ欄に）
    await expect(page.getByRole('radio', { name: '使用中' })).toBeChecked();
    await expect(productCards(page)).toHaveCount(4);
    await expect(page.getByTestId('product-list')).not.toContainText('クレラップ');
    await expect(page.getByTestId('archived-products')).toContainText('使用停止中の商品（1件）');

    await page.getByRole('radio', { name: '使用停止' }).check();
    await expect(productCards(page)).toHaveCount(1);
    await expect(page.getByTestId('product-list')).toContainText('クレラップ');
    await expect(page.getByTestId('product-count')).toHaveText('1件');
    await expect(page.getByTestId('archived-products')).toHaveCount(0);

    await page.getByRole('radio', { name: 'すべて' }).check();
    await expect(productCards(page)).toHaveCount(5);
    await expect(page.getByTestId('product-count')).toHaveText('5件');

    // 状態と検索語の組み合わせ
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('ラップ');
    await expect(productCards(page)).toHaveCount(2);
    await expect(page.getByTestId('product-count')).toHaveText('2 / 5件');

    await page.getByRole('button', { name: 'クリア', exact: true }).click();
    await expect(page.getByRole('radio', { name: '使用中' })).toBeChecked();
    await expect(page.getByRole('searchbox', { name: '商品を検索' })).toHaveValue('');
    await expect(productCards(page)).toHaveCount(4);
  });

  test('使用停止の商品がなければ「使用停止中の商品はありません」', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('radio', { name: '使用停止' }).check();
    await expect(page.getByTestId('product-empty')).toContainText('使用停止中の商品はありません');
    await expect(page.getByTestId('product-no-match')).toHaveCount(0);
  });

  test('検索しても、商品の編集・登録はこれまでどおり使える', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('麦茶');
    await page.getByRole('button', { name: 'やさしい麦茶を編集' }).click();
    await page.getByRole('form', { name: '商品の編集' }).getByLabel('品目').fill('やさしい麦茶 2L');
    await page.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('status')).toContainText('P005 やさしい麦茶 2L を更新しました');
    await expect(productCards(page)).toHaveCount(1);
  });
});

test.describe('店舗の検索', () => {
  test('店舗名の部分一致・種類・英字の大文字小文字', async ({ page }) => {
    await page.goto('/stores');
    await expect(page.getByTestId('store-count')).toHaveText('9件');
    const search = page.getByRole('searchbox', { name: '店舗を検索' });
    await search.fill('ドン');
    await expect(storeRows(page)).toHaveCount(1);
    await expect(page.getByTestId('store-list')).toContainText('ドン・キホーテ');
    await expect(page.getByTestId('store-count')).toHaveText('1 / 9件');

    await search.fill('ディスカウント');
    await expect(storeRows(page)).toHaveCount(3);

    await search.fill('AMAZON');
    await expect(storeRows(page)).toHaveCount(1);
    await expect(page.getByTestId('store-list')).toContainText('Amazon');
    await search.fill('  amazon ');
    await expect(storeRows(page)).toHaveCount(1);
  });

  test('0件のときは「該当する店舗がありません」', async ({ page }) => {
    await page.goto('/stores');
    await page.getByRole('searchbox', { name: '店舗を検索' }).fill('業務スーパー');
    await expect(page.getByTestId('store-no-match')).toContainText('該当する店舗がありません');
    await expect(page.getByTestId('store-count')).toHaveText('0 / 9件');
    await page.getByRole('button', { name: 'クリア', exact: true }).click();
    await expect(storeRows(page)).toHaveCount(9);
  });

  test('使用中／使用停止／すべて（商品と同じ操作）', async ({ page }) => {
    await setSaved(page, (d) => {
      const stores = d.stores as { id: string; archived?: boolean }[];
      stores.find((s) => s.id === 'S007')!.archived = true;
      stores.find((s) => s.id === 'S008')!.archived = true;
    });
    await page.goto('/stores');
    await expect(storeRows(page)).toHaveCount(7);
    await expect(page.getByTestId('archived-stores')).toContainText('使用停止中の店舗（2件）');
    await page.getByRole('radio', { name: '使用停止' }).check();
    await expect(storeRows(page)).toHaveCount(2);
    await expect(page.getByTestId('store-list')).toContainText('Amazon');
    await expect(page.getByTestId('store-list')).toContainText('楽天市場');
    await page.getByRole('radio', { name: 'すべて' }).check();
    await expect(storeRows(page)).toHaveCount(9);
    await page.getByRole('searchbox', { name: '店舗を検索' }).fill('楽天');
    await expect(storeRows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'クリア', exact: true }).click();
    await expect(page.getByRole('radio', { name: '使用中' })).toBeChecked();
    await expect(storeRows(page)).toHaveCount(7);
  });
});

test.describe('価格履歴の検索・期間', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/history?product=all');
  });

  test('「すべての商品」で全記録を新しい順に表示する', async ({ page }) => {
    await expect(page.locator('#history-product')).toHaveValue('all');
    await expect(recordRows(page)).toHaveCount(10);
    await expect(page.getByTestId('record-count')).toHaveText('10件');
    await expect(recordRows(page).first()).toContainText('やさしい麦茶');
    await expect(recordRows(page).first()).toContainText('9/22 ミスターマックス');
    await expect(page.getByTestId('hist-count')).toHaveCount(0); // 商品ごとの集計は出さない
  });

  test('商品名で検索', async ({ page }) => {
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('麦茶');
    await expect(recordRows(page)).toHaveCount(4);
    await expect(page.getByTestId('record-count')).toHaveText('4 / 10件');
  });

  test('店舗名で検索（同じ検索欄）、商品名との組み合わせ', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: '価格履歴を検索' });
    await search.fill('コストコ');
    await expect(recordRows(page)).toHaveCount(4);
    await search.fill('イオン');
    await expect(recordRows(page)).toHaveCount(2);
    await search.fill('麦茶　イオン'); // 全角空白で区切っても AND
    await expect(recordRows(page)).toHaveCount(1);
    await expect(recordRows(page).first()).toContainText('180');
  });

  test('英字の大文字小文字（店舗名を英字に変更して確認）', async ({ page }) => {
    await setSaved(page, (d) => {
      const stores = d.stores as { id: string; name: string }[];
      stores.find((s) => s.id === 'S009')!.name = 'MrMax';
    });
    await page.goto('/history?product=all');
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('MRMAX');
    await expect(recordRows(page)).toHaveCount(2);
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill(' mrmax ');
    await expect(recordRows(page)).toHaveCount(2);
  });

  test('開始日のみ（その日を含む）', async ({ page }) => {
    await page.getByLabel('開始日').fill('2026-09-21');
    await expect(recordRows(page)).toHaveCount(5);
    await expect(page.getByTestId('record-count')).toHaveText('5 / 10件');
  });

  test('終了日のみ（その日を含む）', async ({ page }) => {
    await page.getByLabel('終了日').fill('2026-09-05');
    await expect(recordRows(page)).toHaveCount(2);
    await expect(recordRows(page).first()).toContainText('つや姫');
  });

  test('開始日＋終了日（両端の日を含む）', async ({ page }) => {
    await page.getByLabel('開始日').fill('2026-09-05');
    await page.getByLabel('終了日').fill('2026-09-12');
    await expect(recordRows(page)).toHaveCount(3);
    const text = await page.getByTestId('history-list').innerText();
    expect(text).toContain('9/5');
    expect(text).toContain('9/12');
    await page.getByLabel('開始日').fill('2026-09-22');
    await page.getByLabel('終了日').fill('2026-09-22');
    await expect(recordRows(page)).toHaveCount(1);
  });

  test('開始日が終了日より後なら、入れ替えて絞り込み、その旨を表示する', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByLabel('開始日').fill('2026-09-12');
    await page.getByLabel('終了日').fill('2026-09-05');
    await expect(page.getByTestId('period-swapped')).toContainText('2026-09-05 〜 2026-09-12');
    await expect(recordRows(page)).toHaveCount(3);
    expect(errors).toEqual([]);
    await page.getByLabel('終了日').fill('2026-09-30');
    await expect(page.getByTestId('period-swapped')).toHaveCount(0);
  });

  test('0件のときは「該当する価格履歴がありません」。クリアで検索語と期間をまとめて解除', async ({ page }) => {
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('麦茶');
    await page.getByLabel('開始日').fill('2027-01-01');
    await page.getByLabel('終了日').fill('2027-01-31');
    await expect(page.getByTestId('record-no-match')).toContainText('該当する価格履歴がありません');
    await expect(page.getByTestId('record-count')).toHaveText('0 / 10件');

    await page.getByRole('button', { name: 'クリア', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: '価格履歴を検索' })).toHaveValue('');
    await expect(page.getByLabel('開始日')).toHaveValue('');
    await expect(page.getByLabel('終了日')).toHaveValue('');
    await expect(recordRows(page)).toHaveCount(10);
    await expect(page.getByTestId('record-count')).toHaveText('10件');
  });

  test('商品ごとの表示でも絞り込める（集計・グラフは全期間のまま）', async ({ page }) => {
    await page.goto('/history?product=P005');
    await expect(recordRows(page)).toHaveCount(4);
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('ミスター');
    await expect(recordRows(page)).toHaveCount(2);
    await expect(page.getByTestId('hist-count')).toContainText('4');
    await expect(page.getByText('上の集計とグラフは全期間の記録です')).toBeVisible();
    // 商品を切り替えても条件は残る
    await page.locator('#history-product').selectOption('all');
    await expect(recordRows(page)).toHaveCount(2);
    await expect(page.getByRole('searchbox', { name: '価格履歴を検索' })).toHaveValue('ミスター');
  });

  test('検索結果の記録も修正できる（各画面に反映）', async ({ page }) => {
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('クレラップ');
    await page.getByRole('button', { name: /（R007）を修正/ }).click();
    const form = page.getByRole('form', { name: '価格記録の修正' });
    await form.getByLabel('販売価格').fill('1600');
    await form.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('status')).toContainText('R007 を修正しました');
    await expect(recordRows(page).first()).toContainText('400');
    await page.goto('/history?product=P002');
    await expect(page.getByTestId('hist-current')).toContainText('400');
  });

  test('検索条件は保存データに入らない', async ({ page }) => {
    const before = await rawSaved(page);
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('麦茶');
    await page.getByLabel('開始日').fill('2026-09-01');
    await page.goto('/products');
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('ラップ');
    await page.getByRole('radio', { name: 'すべて' }).check();
    expect(await rawSaved(page)).toBe(before);
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(keys.filter((k) => k.includes('search') || k.includes('filter'))).toEqual([]);
  });
});

test.describe('レイアウト', () => {
  test('検索欄で一覧の領域が狭くなりすぎず、横スクロールも出ない', async ({ page }, info) => {
    const sp = info.project.name === 'smartphone';
    for (const path of ['/products', '/stores', '/history?product=all']) {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
      const bar = await page.getByRole('search').boundingBox();
      // スマホでも検索欄＋フィルターは2〜3段程度に収まる（価格履歴は期間欄があるため少し高い）
      expect(bar!.height).toBeLessThan(path.includes('history') ? 220 : 120);
      // 押しやすい高さ
      const input = await page.getByRole('searchbox').boundingBox();
      expect(input!.height).toBeGreaterThanOrEqual(44);
      if (!path.includes('history')) {
        const radio = await page.locator('.segmented label').first().boundingBox();
        expect(radio!.height).toBeGreaterThanOrEqual(36);
      }
      // PCでは検索欄を横いっぱいに広げない
      if (!sp) expect(input!.width).toBeLessThanOrEqual(480);
    }
    // 0件表示・期間入れ替えの表示でも横スクロールしない
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('該当なしの検索語');
    await page.getByLabel('開始日').fill('2026-09-30');
    await page.getByLabel('終了日').fill('2026-09-01');
    await expect(page.getByTestId('record-no-match')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

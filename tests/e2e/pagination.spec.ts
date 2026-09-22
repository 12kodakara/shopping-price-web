import { expect, test, type Page } from '@playwright/test';
import { largeData, type LargeDataOptions } from '../fixtures/largeData';

// 第6回: 一覧のページ分割（商品・店舗・価格履歴）と大量データでの動作
// データは Playwright がテストごとに作る独立したブラウザ環境の localStorage に入れる（普段使いのデータには触れない）。

const KEY = 'shopping-price-web/v1';

async function seed(page: Page, opts: LargeDataOptions) {
  await page.goto('/');
  await page.evaluate(([key, json]) => localStorage.setItem(key, json), [KEY, JSON.stringify(largeData(opts))] as const);
}

async function expectNoHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, '横スクロールが発生している').toBeLessThanOrEqual(cw);
}

const productCards = (page: Page) => page.getByTestId('product-list').locator('> li');
const storeRows = (page: Page) => page.getByTestId('store-list').locator('> li');
const recordRows = (page: Page) => page.getByTestId('history-list').locator('> li');
const next = (page: Page) => page.getByRole('navigation', { name: 'ページ' }).getByRole('button', { name: /次へ/ });
const prev = (page: Page) => page.getByRole('navigation', { name: 'ページ' }).getByRole('button', { name: /前へ/ });
const pagerStatus = (page: Page) => page.locator('.pager-status');

test.describe('件数の境界', () => {
  test('0件: 空の表示で、ページ操作は出さない', async ({ page }) => {
    await seed(page, { products: 0, stores: 1, records: 0 });
    await page.goto('/products');
    await expect(page.getByTestId('product-empty')).toBeVisible();
    await expect(page.getByTestId('product-pager')).toHaveCount(0);
    await expect(page.getByTestId('product-count')).toHaveText('0件');
  });

  const cases: [number, number, string, string | null][] = [
    // 商品数, 1ページ目の件数, 件数表示, ページ表示
    [1, 1, '1件', null],
    [49, 49, '49件', null],
    [50, 50, '50件', null],
    [51, 50, '全51件中 1〜50件', '1 / 2ページ'],
    [100, 50, '全100件中 1〜50件', '1 / 2ページ'],
    [101, 50, '全101件中 1〜50件', '1 / 3ページ'],
  ];
  for (const [n, onPage, count, status] of cases) {
    test(`商品${n}件`, async ({ page }) => {
      await seed(page, { products: n, stores: 1, records: 0 });
      await page.goto('/products');
      await expect(productCards(page)).toHaveCount(onPage);
      await expect(page.getByTestId('product-count')).toHaveText(count);
      if (status) await expect(pagerStatus(page)).toHaveText(status);
      else await expect(page.getByTestId('product-pager')).toHaveCount(0);
    });
  }
});

test.describe('ページの移動', () => {
  test('最初・中間・最後のページと、前へ・次へ', async ({ page }) => {
    await seed(page, { products: 101, stores: 1, records: 0 });
    await page.goto('/products');
    // 最初のページ: 前へは押せない
    await expect(prev(page)).toBeDisabled();
    await expect(productCards(page).first()).toContainText('P001');

    await next(page).click();
    await expect(pagerStatus(page)).toHaveText('2 / 3ページ');
    await expect(page.getByTestId('product-count')).toHaveText('全101件中 51〜100件');
    await expect(productCards(page).first()).toContainText('P051');
    await expect(productCards(page).last()).toContainText('P100');
    await expect(prev(page)).toBeEnabled();
    await expect(next(page)).toBeEnabled();
    // 移動したら一覧の先頭（検索欄）が見える位置へ戻る
    await expect(page.getByRole('searchbox', { name: '商品を検索' })).toBeInViewport();

    await next(page).click();
    await expect(pagerStatus(page)).toHaveText('3 / 3ページ');
    await expect(productCards(page)).toHaveCount(1);
    await expect(productCards(page).first()).toContainText('P101');
    await expect(page.getByTestId('product-count')).toHaveText('全101件中 101〜101件');
    await expect(next(page)).toBeDisabled();

    await prev(page).click();
    await expect(pagerStatus(page)).toHaveText('2 / 3ページ');
  });

  test('店舗も同じ操作でページ移動できる', async ({ page }) => {
    await seed(page, { products: 1, stores: 120, records: 0 });
    await page.goto('/stores');
    await expect(storeRows(page)).toHaveCount(50);
    await expect(page.getByTestId('store-count')).toHaveText('全120件中 1〜50件');
    await next(page).click();
    await next(page).click();
    await expect(pagerStatus(page)).toHaveText('3 / 3ページ');
    await expect(storeRows(page)).toHaveCount(20);
  });
});

test.describe('検索・絞り込みとの連携（1ページ目に戻る）', () => {
  test('検索語を変えると1ページ目に戻る（存在しないページを出さない）', async ({ page }) => {
    await seed(page, { products: 500, stores: 1, records: 0 });
    await page.goto('/products');
    for (let i = 0; i < 7; i++) await next(page).click();
    await expect(pagerStatus(page)).toHaveText('8 / 10ページ');

    // 「牛乳」は 500件中 50件（1ページに収まる）
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('牛乳');
    await expect(page.getByTestId('product-count')).toHaveText('50 / 500件');
    await expect(productCards(page)).toHaveCount(50);
    await expect(productCards(page).first()).toContainText('牛乳 0001');
    await expect(page.getByTestId('product-pager')).toHaveCount(0);

    // 検索は常に全件が対象（表示中のページだけではない）
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('牛乳 0491');
    await expect(productCards(page)).toHaveCount(1);
  });

  test('検索結果が複数ページのときも、条件を変えると1ページ目へ', async ({ page }) => {
    await seed(page, { products: 500, stores: 1, records: 0 });
    await page.goto('/products');
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('食品'); // 100件
    await expect(page.getByTestId('product-count')).toHaveText('100 / 500件（1〜50件目）');
    await next(page).click();
    await expect(page.getByTestId('product-count')).toHaveText('100 / 500件（51〜100件目）');
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('飲料');
    await expect(pagerStatus(page)).toHaveText('1 / 2ページ');
  });

  test('使用中／使用停止を変えると1ページ目に戻る', async ({ page }) => {
    await seed(page, { products: 300, stores: 1, records: 0, archivedProductRatio: 0.5 });
    await page.goto('/products');
    await expect(page.getByTestId('product-count')).toHaveText('全150件中 1〜50件');
    await next(page).click();
    await next(page).click();
    await expect(pagerStatus(page)).toHaveText('3 / 3ページ');
    await page.getByRole('radio', { name: 'すべて' }).check();
    await expect(pagerStatus(page)).toHaveText('1 / 6ページ');
    await expect(page.getByTestId('product-count')).toHaveText('全300件中 1〜50件');
    await next(page).click();
    await page.getByRole('radio', { name: '使用停止' }).check();
    await expect(pagerStatus(page)).toHaveText('1 / 3ページ');
  });

  test('「クリア」で1ページ目に戻る', async ({ page }) => {
    await seed(page, { products: 500, stores: 1, records: 0 });
    await page.goto('/products');
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('食品');
    await next(page).click();
    await expect(pagerStatus(page)).toHaveText('2 / 2ページ');
    await page.getByRole('button', { name: 'クリア', exact: true }).click();
    await expect(pagerStatus(page)).toHaveText('1 / 10ページ');
    await expect(page.getByTestId('product-count')).toHaveText('全500件中 1〜50件');
  });

  test('価格履歴: 検索語・日付を変えると1ページ目に戻り、クリアでも1ページ目', async ({ page }) => {
    await seed(page, { products: 50, stores: 20, records: 1000 });
    await page.goto('/history?product=all');
    await expect(page.getByTestId('record-count')).toHaveText('全1000件中 1〜50件');
    await next(page).click();
    await next(page).click();
    await expect(pagerStatus(page)).toHaveText('3 / 20ページ');

    await page.getByLabel('開始日').fill('2026-01-01');
    await expect(pagerStatus(page)).toHaveText(/^1 \//);
    await next(page).click();
    await page.getByLabel('終了日').fill('2026-06-30');
    await expect(pagerStatus(page)).toHaveText(/^1 \//);
    await next(page).click();
    await expect(pagerStatus(page)).toHaveText(/^2 \//);
    // 全件に該当する語で検索しても（結果が複数ページでも）1ページ目に戻る
    await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('テスト店');
    await expect(pagerStatus(page)).toHaveText(/^1 \//);
    await expect(page.getByTestId('record-count')).toContainText(' / 1000件（1〜50件目）');

    await page.getByRole('button', { name: 'クリア', exact: true }).click();
    await expect(page.getByTestId('record-count')).toHaveText('全1000件中 1〜50件');
    await expect(pagerStatus(page)).toHaveText('1 / 20ページ');
  });

  test('価格履歴は「絞り込み → 新しい順 → ページ分割」の順で、2ページ目は51〜100件目', async ({ page }) => {
    const opts = { products: 20, stores: 5, records: 120 };
    await seed(page, opts);
    // 期待する並び: 日付の新しい順、同じ日なら後から登録した順
    const expected = [...largeData(opts).priceRecords]
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.seq - a.seq))
      .map((r) => r.id);
    const idsOnPage = async () =>
      (await recordRows(page).getByRole('button', { name: /を修正/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '')))
        .map((label) => label.match(/（(R\d+)）/)![1]);

    await page.goto('/history?product=all');
    expect(await idsOnPage()).toEqual(expected.slice(0, 50));
    await next(page).click();
    await expect(page.getByTestId('record-count')).toHaveText('全120件中 51〜100件');
    expect(await idsOnPage()).toEqual(expected.slice(50, 100));
    await next(page).click();
    expect(await idsOnPage()).toEqual(expected.slice(100));
  });
});

test.describe('データ変更時のページ補正', () => {
  test('最後のページの1件を削除すると、存在する最後のページを表示する（価格履歴）', async ({ page }) => {
    await seed(page, { products: 10, stores: 5, records: 101 });
    await page.goto('/history?product=all');
    await next(page).click();
    await next(page).click();
    await expect(pagerStatus(page)).toHaveText('3 / 3ページ');
    await expect(recordRows(page)).toHaveCount(1);

    await recordRows(page).first().getByRole('button', { name: /を修正/ }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この記録を削除' }).click();
    await expect(page.getByRole('status')).toContainText('を削除しました');
    await expect(pagerStatus(page)).toHaveText('2 / 2ページ');
    await expect(recordRows(page)).toHaveCount(50);
    await expect(page.getByTestId('record-count')).toHaveText('全100件中 51〜100件');
  });

  test('最後のページの1件を削除すると前のページへ（店舗）', async ({ page }) => {
    await seed(page, { products: 1, stores: 51, records: 0 });
    await page.goto('/stores');
    await next(page).click();
    await expect(storeRows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'テスト店 051を編集' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'この店舗を削除' }).click();
    await expect(page.getByRole('status')).toContainText('S051 テスト店 051 を削除しました');
    await expect(storeRows(page)).toHaveCount(50);
    await expect(page.getByTestId('store-pager')).toHaveCount(0);
    await expect(page.getByTestId('store-count')).toHaveText('50件');
  });

  test('使用停止で件数が減ると、件数表示とページが追従する', async ({ page }) => {
    await seed(page, { products: 51, stores: 1, records: 0 });
    await page.goto('/products');
    await next(page).click();
    await expect(productCards(page)).toHaveCount(1);
    await page.getByRole('button', { name: /0051を編集/ }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '使用停止にする' }).click();
    await expect(page.getByRole('status')).toContainText('使用停止にしました');
    await expect(page.getByTestId('product-count')).toHaveText('50件');
    await expect(productCards(page)).toHaveCount(50);
    await expect(page.getByTestId('product-pager')).toHaveCount(0);
    await expect(page.getByTestId('archived-products')).toContainText('使用停止中の商品（1件）');
  });

  test('深いページにある記録も「修正」リンクから直接開ける', async ({ page }) => {
    await seed(page, { products: 10, stores: 5, records: 300 });
    await page.goto('/history?product=all');
    await next(page).click();
    await next(page).click();
    await next(page).click();
    const id = (await recordRows(page).first().getByRole('button', { name: /を修正/ }).getAttribute('aria-label'))!.match(/（(R\d+)）/)![1];
    await page.goto(`/history?product=all&edit=${id}`);
    const form = page.getByRole('form', { name: '価格記録の修正' });
    await expect(form).toContainText(id);
    await expect(pagerStatus(page)).toHaveText('4 / 6ページ');
    await form.getByRole('button', { name: 'キャンセル' }).click();
    await expect(pagerStatus(page)).toHaveText('4 / 6ページ'); // 閉じても同じページのまま
  });
});

test.describe('大量データ', () => {
  const timed = async (page: Page, path: string, ready: string) => {
    const t0 = Date.now();
    await page.goto(path);
    await page.getByTestId(ready).waitFor();
    return Date.now() - t0;
  };

  for (const n of [500, 1000]) {
    test(`商品${n}件: 表示は50件だけ描画し、検索も全件が対象`, async ({ page }) => {
      await seed(page, { products: n, stores: 10, records: 1000 });
      const ms = await timed(page, '/products', 'product-list');
      expect(ms).toBeLessThan(3000);
      await expect(productCards(page)).toHaveCount(50);
      await expect(page.getByTestId('product-count')).toHaveText(`全${n}件中 1〜50件`);
      const last = String(n).padStart(4, '0');
      await page.getByRole('searchbox', { name: '商品を検索' }).fill(last);
      await expect(productCards(page)).toHaveCount(1);
      await expect(productCards(page).first()).toContainText(last);
      const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
      expect(nodes).toBeLessThan(3000);
    });
  }

  for (const n of [1000, 5000]) {
    test(`価格履歴${n}件: 全商品の表示・検索・期間絞り込み`, async ({ page }) => {
      test.setTimeout(60000);
      await seed(page, { products: 1000, stores: 100, records: n });
      const ms = await timed(page, '/history?product=all', 'history-list');
      expect(ms).toBeLessThan(3000);
      await expect(recordRows(page)).toHaveCount(50);
      await expect(page.getByTestId('record-count')).toHaveText(`全${n}件中 1〜50件`);

      const t0 = Date.now();
      await page.getByRole('searchbox', { name: '価格履歴を検索' }).fill('テスト店 042');
      await expect(page.getByTestId('record-count')).toContainText(` / ${n}件`);
      expect(Date.now() - t0).toBeLessThan(1500);
      // 空白で区切った語はすべて含むもの（AND）: 「テスト店」と「042」の両方を含む（商品名側の 042 でもよい）
      const texts = await recordRows(page).allInnerTexts();
      expect(texts.length).toBeGreaterThan(0);
      expect(texts.every((t) => t.includes('テスト店') && t.includes('042'))).toBe(true);
      expect(texts.some((t) => t.includes('テスト店 042'))).toBe(true);

      await page.getByLabel('開始日').fill('2026-03-01');
      await page.getByLabel('終了日').fill('2026-03-31');
      const dateTexts = await recordRows(page).allInnerTexts();
      expect(dateTexts.every((t) => /(^|\n)3\/\d+ /.test(t))).toBe(true);

      const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
      expect(nodes).toBeLessThan(3000);
    });
  }

  test('買い物候補はページ分割しない（全件を続けて表示）', async ({ page }) => {
    await seed(page, { products: 200, stores: 10, records: 2000 });
    await page.goto('/shopping');
    const count = Number(await page.getByTestId('candidate-count').innerText());
    expect(count).toBeGreaterThan(50);
    await expect(page.getByTestId('candidate-list').locator('> li')).toHaveCount(count);
    await expect(page.getByRole('navigation', { name: 'ページ' })).toHaveCount(0);
  });

  test('価格比較は画面幅に合う表示だけを描画する（1,000商品）', async ({ page }, info) => {
    await seed(page, { products: 1000, stores: 100, records: 5000 });
    await page.goto('/compare');
    if (info.project.name === 'smartphone') {
      await expect(page.getByTestId('compare-cards')).toBeVisible();
      await expect(page.getByTestId('compare-table')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('compare-table')).toBeVisible();
      await expect(page.getByTestId('compare-cards')).toHaveCount(0);
    }
  });
});

test.describe('レイアウト', () => {
  test('ページ操作は押しやすく、横スクロールせず、下部ナビに隠れない', async ({ page }, info) => {
    await seed(page, { products: 120, stores: 120, records: 500 });
    for (const [path, pager] of [['/products', 'product-pager'], ['/stores', 'store-pager'], ['/history?product=all', 'record-pager']] as const) {
      await page.goto(path);
      const nav = page.getByTestId(pager);
      await expect(nav).toBeVisible();
      await expectNoHorizontalScroll(page);
      const box = await nav.boundingBox();
      expect(box!.height).toBeLessThan(80); // 1行に収まる
      const btn = await next(page).boundingBox();
      expect(btn!.height).toBeGreaterThanOrEqual(44);
      expect(btn!.width).toBeGreaterThanOrEqual(80);

      if (info.project.name === 'smartphone') {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const bottomNav = await page.getByTestId('bottom-nav').boundingBox();
        const pagerBox = await nav.boundingBox();
        expect(pagerBox!.y + pagerBox!.height).toBeLessThanOrEqual(bottomNav!.y);
        await next(page).click();
        await expect(pagerStatus(page)).toHaveText(/^2 \//);
      }
    }
  });
});

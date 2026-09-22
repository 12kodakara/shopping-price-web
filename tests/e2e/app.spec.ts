import { expect, test, type Page } from '@playwright/test';

const pages = [
  { path: '/', heading: 'ホーム' },
  { path: '/products', heading: '商品' },
  { path: '/prices/new', heading: '価格登録' },
  { path: '/compare', heading: '価格比較' },
  { path: '/shopping', heading: '買い物候補' },
  { path: '/history', heading: '価格履歴' },
  { path: '/stores', heading: '店舗' },
];

const isSmartphone = (name: string) => name === 'smartphone';

/** 横スクロールが発生していないこと（ページ幅が画面幅を超えない） */
async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, '横スクロールが発生している').toBeLessThanOrEqual(clientWidth);
}

test.describe('各ページの表示', () => {
  for (const p of pages) {
    test(`${p.path} が表示でき、横スクロールが出ない`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await expectNoHorizontalScroll(page);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('PC版ナビゲーション', () => {
  test.beforeEach(({}, info) => test.skip(isSmartphone(info.project.name), 'PC幅のみ'));

  test('サイドバーが表示され、スマホ用ナビは非表示', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('sidebar-nav')).toBeVisible();
    await expect(page.getByTestId('bottom-nav')).toBeHidden();
  });

  test('サイドバーの全項目が正しいページへ移動し、現在位置が強調される', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByTestId('sidebar-nav');
    for (const p of pages) {
      const link = nav.getByRole('link', { name: p.heading, exact: true });
      await link.click();
      await expect(page).toHaveURL(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await expect(link).toHaveClass(/active/);
      await expect(nav.locator('a.active')).toHaveCount(1);
    }
  });

  test('価格比較は表形式で表示', async ({ page }) => {
    await page.goto('/compare');
    await expect(page.getByTestId('compare-table')).toBeVisible();
    await expect(page.getByTestId('compare-cards')).toBeHidden();
    await expect(page.getByTestId('compare-table').locator('tbody tr')).toHaveCount(5);
  });
});

test.describe('スマホ版ナビゲーション', () => {
  test.beforeEach(({}, info) => test.skip(!isSmartphone(info.project.name), 'スマホ幅のみ'));

  const bottom = [
    { label: 'ホーム', path: '/' },
    { label: '商品', path: '/products' },
    { label: '価格登録', path: '/prices/new' },
    { label: '価格比較', path: '/compare' },
    { label: '買い物候補', path: '/shopping' },
  ];

  test('下部ナビが表示され、サイドバーは非表示', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('bottom-nav')).toBeVisible();
    await expect(page.getByTestId('sidebar-nav')).toBeHidden();
    await expect(page.getByTestId('bottom-nav').getByRole('link')).toHaveCount(5);
  });

  test('下部ナビの5項目が正しいページへ移動する', async ({ page }) => {
    await page.goto('/stores');
    const nav = page.getByTestId('bottom-nav');
    for (const b of bottom) {
      const link = nav.getByRole('link', { name: b.label, exact: true });
      await link.click();
      await expect(page).toHaveURL(b.path);
      await expect(link).toHaveClass(/active/);
    }
  });

  test('「＋価格」が中央で他より大きい', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByTestId('bottom-nav');
    const links = nav.getByRole('link');
    await expect(links.nth(2)).toHaveAccessibleName('価格登録');
    const plus = await nav.locator('.bottom-link-primary .bottom-icon').boundingBox();
    const home = await nav.locator('.bottom-link').first().locator('.bottom-icon').boundingBox();
    expect(plus!.height).toBeGreaterThan(home!.height);
  });

  test('メニューから全ページ（価格履歴・店舗を含む）へ移動できる', async ({ page }) => {
    await page.goto('/');
    for (const p of pages) {
      await page.getByRole('button', { name: 'メニューを開く' }).click();
      const menu = page.getByTestId('menu-nav');
      await expect(menu).toBeVisible();
      await menu.getByRole('link', { name: p.heading, exact: true }).click();
      await expect(page).toHaveURL(p.path);
      await expect(menu).toBeHidden();
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
    }
  });

  test('価格比較はカード形式で表示', async ({ page }) => {
    await page.goto('/compare');
    await expect(page.getByTestId('compare-cards')).toBeVisible();
    await expect(page.getByTestId('compare-table')).toBeHidden();
    await expect(page.getByTestId('compare-cards').locator('> li')).toHaveCount(5);
  });
});

test.describe('ホーム', () => {
  test('仮データの件数と「価格を登録」ボタン', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('stat-shopping')).toContainText('4');
    await expect(page.getByTestId('stat-products')).toContainText('5');
    await expect(page.getByTestId('stat-stores')).toContainText('9');
    await expect(page.getByText('最近登録した価格')).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: '価格を登録' }).click();
    await expect(page).toHaveURL('/prices/new');
  });
});

test.describe('価格登録UI', () => {
  test('入力すると単価と目安との差が計算される（やさしい麦茶 6本 840円）', async ({ page }) => {
    await page.goto('/prices/new');
    const result = page.getByTestId('price-result');
    await page.locator('#product').selectOption('P005');
    await page.locator('#store').selectOption({ label: 'ミスターマックス' });
    await expect(page.getByLabel('日付')).not.toHaveValue('');
    await page.getByLabel('販売数量').fill('6');
    await page.getByLabel('販売価格').fill('840');
    await page.getByLabel('セール価格（任意）').check();
    await page.getByLabel('備考（任意）').fill('2L×6本');

    await expect(result).toContainText('やさしい麦茶');
    await expect(result).toContainText('1本あたり');
    await expect(result).toContainText('140');
    await expect(result).toContainText('160');
    await expect(result.getByTestId('result-verdict')).toContainText('目安より20円安い');
    await expect(result).toContainText('セール');
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');
  });

  test('目安より高い場合は「高い」と表示', async ({ page }) => {
    await page.goto('/prices/new?product=P005');
    await page.getByLabel('販売数量').fill('6');
    await page.getByLabel('販売価格').fill('1080');
    await expect(page.getByTestId('result-verdict')).toContainText('目安より20円高い');
  });

  test('未入力のまま登録すると不足項目を知らせる／クリアで初期化', async ({ page }) => {
    await page.goto('/prices/new');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('未入力');
    await page.locator('#product').selectOption('P001');
    await page.getByRole('button', { name: 'クリア' }).click();
    await expect(page.locator('#product')).toHaveValue('');
  });
});

test.describe('その他の画面', () => {
  test('商品一覧に P001〜P005 が表示される', async ({ page }) => {
    await page.goto('/products');
    const list = page.getByTestId('product-list');
    for (const id of ['P001', 'P002', 'P003', 'P004', 'P005']) await expect(list).toContainText(id);
    await expect(list).toContainText('ムシューダ クローゼット用');
    await page.getByRole('button', { name: '＋ 商品登録' }).click();
    await expect(page.getByRole('form', { name: '商品登録' })).toBeVisible();
  });

  test('買い物候補: 麦茶が先頭、「今回買う」が切り替わる', async ({ page }) => {
    await page.goto('/shopping');
    const first = page.getByTestId('candidate-list').locator('> li').first();
    await expect(first).toContainText('やさしい麦茶');
    await expect(first).toContainText('ミスターマックス');
    await expect(first).toContainText('目安より20円安い');
    const buy = first.getByRole('button', { name: /今回買う/ });
    await buy.click();
    await expect(buy).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('selected-count')).toHaveText('1');
  });

  test('価格履歴: 商品を切り替えると集計が変わる', async ({ page }) => {
    await page.goto('/history');
    await expect(page.getByTestId('hist-current')).toContainText('140');
    await expect(page.getByTestId('hist-previous')).toContainText('158');
    await expect(page.getByTestId('hist-highest')).toContainText('180');
    await expect(page.getByTestId('hist-count')).toContainText('4');
    await expect(page.getByTestId('trend-chart')).toBeVisible();
    await page.getByLabel('商品を選択').selectOption('P002');
    await expect(page.getByTestId('hist-count')).toContainText('1');
    await expect(page.getByText('記録が2件以上になると推移を表示します')).toBeVisible();
  });

  test('店舗一覧に9店舗と追加ボタン', async ({ page }) => {
    await page.goto('/stores');
    await expect(page.getByTestId('store-list').locator('> li')).toHaveCount(9);
    await expect(page.getByRole('button', { name: '＋ 店舗追加' })).toBeVisible();
  });
});

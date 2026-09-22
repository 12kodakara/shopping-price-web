import { appendFileSync, mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { largeData } from '../fixtures/largeData';

// 大量データでの画面表示時間の計測（第6回）。通常のテスト（npm run test:e2e）には含めない。
// Playwright がテストごとに作る独立したブラウザ環境で動かすので、普段使いのデータには触れない。

// 計測結果の出力先（npm run perf:render で実行。既定は test-results/render-measure.txt）
const OUT = process.env.MEASURE_OUT ?? 'test-results/render-measure.txt';
const cases = [
  { products: 100, stores: 100, records: 1000 },
  { products: 500, stores: 100, records: 1000 },
  { products: 1000, stores: 100, records: 1000 },
  { products: 1000, stores: 100, records: 5000 },
];
mkdirSync('test-results', { recursive: true });
test.describe.configure({ mode: 'serial' });
for (const c of cases) {
  test(`measure P${c.products} R${c.records}`, async ({ page }, info) => {
    test.setTimeout(180000);
    const data = largeData(c);
    await page.goto('/');
    await page.evaluate((json) => localStorage.setItem('shopping-price-web/v1', json), JSON.stringify(data));
    const lines: string[] = [];
    const measure = async (label: string, path: string, ready: string) => {
      const t0 = Date.now();
      await page.goto(path);
      await page.locator(ready).first().waitFor({ timeout: 120000 });
      const ms = Date.now() - t0;
      const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
      lines.push(`[${info.project.name} P${c.products}/R${c.records}] ${label}: ${ms}ms (DOM ${nodes})`);
    };
    await measure('ホーム', '/', '[data-testid=stat-products]');
    await measure('商品一覧', '/products', '[data-testid=product-list]');
    await measure('店舗一覧', '/stores', '[data-testid=store-list]');
    await measure('価格比較', '/compare', 'h1');
    await measure('買い物候補', '/shopping', '[data-testid=candidate-count]');
    await measure('価格履歴(全商品)', '/history?product=all', '[data-testid=history-list]');
    // 検索の反応時間: 入力してから件数表示が変わるまで
    await page.goto('/history?product=all');
    await page.locator('[data-testid=record-count]').waitFor();
    let t0 = Date.now();
    await page.getByRole('searchbox').fill('テスト店 01');
    await page.locator('[data-testid=record-count]', { hasText: '/' }).waitFor();
    lines.push(`[${info.project.name} P${c.products}/R${c.records}] 価格履歴の検索反応: ${Date.now() - t0}ms`);
    await page.goto('/products');
    await page.locator('[data-testid=product-count]').waitFor();
    t0 = Date.now();
    await page.getByRole('searchbox').fill('牛乳');
    await page.locator('[data-testid=product-count]', { hasText: '/' }).waitFor();
    lines.push(`[${info.project.name} P${c.products}/R${c.records}] 商品の検索反応: ${Date.now() - t0}ms`);
    appendFileSync(OUT, lines.join('\n') + '\n');
  });
}

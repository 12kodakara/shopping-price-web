import { expect, type Page } from '@playwright/test';

/**
 * 価格登録の「検索付き選択欄」（商品 #product・店舗 #store）で、IDを入力して候補を押して選ぶ。
 * 選択欄は入力欄なので、選んだ値（ID）は data-value 属性で確認する。
 */
export async function choose(page: Page, id: 'product' | 'store', value: string) {
  const input = page.locator(`#${id}`);
  await input.click();
  await input.fill(value);
  await page.getByTestId(`${id}-combobox`).locator(`[role="option"][data-value="${value}"]`).click();
  await expect(input).toHaveAttribute('data-value', value);
}

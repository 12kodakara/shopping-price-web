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

// 第17回: 店頭での入力を速くする（最近使った商品のクイック選択・登録後の状態）
test.describe('最近使った商品から選ぶ', () => {
  test('★最近登録した商品が新しい順に最大3件出て、押すと選択される', async ({ page }) => {
    await page.goto('/prices/new');
    const quick = page.getByTestId('recent-products');
    await expect(quick).toBeVisible();
    await expect(quick).toContainText('最近：');

    // サンプルデータの最後の3商品（新しい順）
    const buttons = quick.getByRole('button');
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveText('やさしい麦茶');
    await expect(buttons.nth(1)).toHaveText('つや姫');
    await expect(buttons.nth(2)).toHaveText('ムシューダ クローゼット用');

    // 押すと商品が選ばれ、計算結果にその商品が出る
    await quick.getByTestId('recent-product-P005').click();
    await expect(quick.getByTestId('recent-product-P005')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('price-result')).toContainText('やさしい麦茶');
  });

  test('★使用停止にした商品は候補から消える（データは消さない）', async ({ page }) => {
    // 商品画面で P005 を使用停止にする（このテスト用のブラウザの中だけ）
    await page.goto('/products');
    await page.getByRole('button', { name: 'やさしい麦茶を編集' }).click();
    const form = page.getByRole('form', { name: '商品の編集' });
    page.once('dialog', (d) => void d.accept());
    await form.getByRole('button', { name: '使用停止にする' }).click();
    await expect(page.getByRole('status')).toContainText('使用停止にしました');

    await page.goto('/prices/new');
    const quick = page.getByTestId('recent-products');
    await expect(quick.getByTestId('recent-product-P005')).toHaveCount(0);
    await expect(quick.getByRole('button')).toHaveCount(3); // 次の候補が繰り上がる
    // 価格履歴は残っている（使用停止は削除ではない）
    expect((await saved(page)).priceRecords.filter((r) => r.productId === 'P005').length).toBeGreaterThan(0);
  });

  test('商品の候補と店舗の候補が両方出て、画面からはみ出さない', async ({ page }) => {
    await page.goto('/prices/new');
    await expect(page.getByTestId('recent-products')).toBeVisible();
    await expect(page.getByTestId('recent-stores')).toBeVisible();

    // 横スクロールが出ない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // どのボタンも画面幅に収まり、押しやすい大きさ（高さ40px以上）
    const width = page.viewportSize()?.width ?? 0;
    for (const group of ['recent-products', 'recent-stores']) {
      for (const button of await page.getByTestId(group).getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        expect(box!.height).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

test.describe('登録したあとの画面の状態', () => {
  test('★店舗と日付は残り、商品・数量・価格・セール・備考は空になる', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'product', 'P005');
    await choose(page, 'store', 'S009');
    await page.locator('#date').fill('2026-09-20');
    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('900');
    await page.getByLabel('セール価格').check();
    await page.locator('#note').fill('テスト備考');

    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');

    // 残るもの
    await expect(page.getByTestId('store-combobox').getByRole('combobox')).toHaveValue(/ミスターマックス/);
    await expect(page.locator('#date')).toHaveValue('2026-09-20');
    // 消えるもの
    await expect(page.getByTestId('product-combobox').getByRole('combobox')).toHaveValue('');
    await expect(page.locator('#quantity')).toHaveValue('');
    await expect(page.locator('#price')).toHaveValue('');
    await expect(page.getByLabel('セール価格')).not.toBeChecked();
    await expect(page.locator('#note')).toHaveValue('');
  });

  test('★続けて同じ店で別の商品を登録できる（最近の候補も更新される）', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'store', 'S002');
    await choose(page, 'product', 'P001');
    await page.locator('#quantity').fill('1');
    await page.locator('#price').fill('450');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');

    // 店舗はそのままなので、商品と数量・価格だけ入れれば登録できる。
    // いま登録した商品が候補の先頭に来る（候補は履歴から求めているため）
    await expect(page.getByTestId('recent-products').getByRole('button').first()).toHaveText('サランラップ');
    await choose(page, 'product', 'P002');
    await page.locator('#quantity').fill('1');
    await page.locator('#price').fill('430');
    // 直後の連打を無視する仕組み（1.5秒）があるので、その時間だけ待ってから押す
    await page.waitForTimeout(1600);
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');

    const records = (await saved(page)).priceRecords;
    expect(records).toHaveLength(12);
    expect(records.slice(-2).map((r) => [r.productId, r.storeId, r.quantity, r.price])).toEqual([
      ['P001', 'S002', 1, 450],
      ['P002', 'S002', 1, 430],
    ]);
  });

  test('登録しても、入力途中でキーボードが勝手に開かない（自動でフォーカスしない）', async ({ page }) => {
    await page.goto('/prices/new');
    await choose(page, 'product', 'P005');
    await choose(page, 'store', 'S009');
    await page.locator('#quantity').fill('6');
    await page.locator('#price').fill('880');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('価格を登録しました');

    // 入力欄に自動で入らない（スマホでキーボードが開かないようにするため）
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName}:${el.getAttribute('type') ?? ''}` : 'なし';
    });
    expect(['BODY:', 'BUTTON:button', 'BUTTON:submit', 'なし']).toContain(focused);
  });
});

// 第19回: 買い物候補を一覧表（PC）とコンパクトなカード（スマホ）で出し分ける
test.describe('買い物候補の一覧表（PC）', () => {
  test.skip(({ isMobile }) => !!isMobile, 'PC表示でのみ確認する');

  test('★一覧表で全件が1行ずつ出て、お得な順で始まる', async ({ page }) => {
    await page.goto('/shopping');
    const table = page.getByTestId('candidate-table');
    await expect(table).toBeVisible();

    // 見出し（必要な列がそろっている）
    for (const label of ['今回買う', '商品名', 'カテゴリ', '最安店', '最安単価', '目安単価', '目安との差', '過去最安', '操作']) {
      await expect(table.getByRole('columnheader', { name: new RegExp(label) })).toBeVisible();
    }

    // 件数は集計と一致し、1商品1行
    const count = Number(await page.getByTestId('candidate-count').innerText());
    await expect(page.getByTestId('candidate-list').locator('> tr')).toHaveCount(count);

    // 初期はお得な順（目安との差が小さい順）
    const first = page.getByTestId('candidate-list').locator('> tr').first();
    await expect(first).toContainText('やさしい麦茶');
    // 単位つきで単価が出る
    await expect(first).toContainText('円/本');
  });

  test('★見出しで昇順・降順・元の並びに切り替わる（aria-sort も変わる）', async ({ page }) => {
    await page.goto('/shopping');
    const names = () => page.getByTestId('candidate-list').locator('> tr td:nth-child(2)').allInnerTexts();
    const before = await names();

    // 商品名で昇順
    await page.getByTestId('candidate-sort-name').click();
    const asc = await names();
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, 'ja')));
    await expect(page.getByRole('columnheader', { name: /商品名/ })).toHaveAttribute('aria-sort', 'ascending');

    // もう一度押すと降順
    await page.getByTestId('candidate-sort-name').click();
    expect(await names()).toEqual([...asc].reverse());
    await expect(page.getByRole('columnheader', { name: /商品名/ })).toHaveAttribute('aria-sort', 'descending');

    // 3回目で元の並び（お得な順）に戻る
    await page.getByTestId('candidate-sort-name').click();
    expect(await names()).toEqual(before);
    await expect(page.getByRole('columnheader', { name: /商品名/ })).toHaveAttribute('aria-sort', 'none');
  });

  test('★金額の列は数値として並ぶ（文字列の並びにならない）', async ({ page }) => {
    await page.goto('/shopping');
    const prices = async () => {
      const texts = await page.getByTestId('candidate-list').locator('> tr td:nth-child(5)').allInnerTexts();
      return texts.map((t) => Number(t.replace(/[^0-9.]/g, '')));
    };

    await page.getByTestId('candidate-sort-unitPrice').click();
    const asc = await prices();
    expect(asc).toEqual([...asc].sort((a, b) => a - b));

    await page.getByTestId('candidate-sort-unitPrice').click();
    const desc = await prices();
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  test('★「目安との差」で並べ替えられる', async ({ page }) => {
    await page.goto('/shopping');
    const diffs = async () => {
      const texts = await page.getByTestId('candidate-list').locator('> tr td:nth-child(7)').allInnerTexts();
      // 「目安より◯円安い」「目安と同じ」などの表示から、安さの大きさを読み取る
      return texts.map((t) => (t.includes('同じ') ? 0 : Number(t.replace(/[^0-9.]/g, '')) || 0));
    };
    await page.getByTestId('candidate-sort-diff').click();
    const asc = await diffs();
    // 昇順＝目安より大幅に安い順（安さの数字が大きい順）
    expect(asc).toEqual([...asc].sort((a, b) => b - a));
  });

  test('★カテゴリ・最安店・目安単価・過去最安でも並べ替えられる', async ({ page }) => {
    await page.goto('/shopping');
    for (const key of ['category', 'store', 'target', 'pastLowest']) {
      await page.getByTestId(`candidate-sort-${key}`).click();
      await expect(page.getByTestId('candidate-list').locator('> tr').first()).toBeVisible();
      await page.getByTestId(`candidate-sort-${key}`).click();
      await expect(page.getByTestId('candidate-list').locator('> tr').first()).toBeVisible();
      await page.getByTestId(`candidate-sort-${key}`).click(); // 元の並びへ戻す
    }
    // どの操作でも件数は変わらない（データが欠けない）
    const count = Number(await page.getByTestId('candidate-count').innerText());
    await expect(page.getByTestId('candidate-list').locator('> tr')).toHaveCount(count);
  });

  test('★一覧から「今回買う」を切り替えられ、選んだ行が色分けされる', async ({ page }) => {
    await page.goto('/shopping');
    const row = page.getByTestId('candidate-P005');
    const buy = row.getByRole('button', { name: /今回買う/ });
    const selectedCount = page.getByTestId('selected-count');
    const before = Number(await selectedCount.innerText());

    await expect(buy).toHaveText('＋ 今回買う');
    await buy.click();
    await expect(buy).toHaveText('✓ 今回買う');
    await expect(buy).toHaveAttribute('aria-pressed', 'true');
    await expect(row).toHaveClass(/row-selected/);
    await expect(selectedCount).toHaveText(String(before + 1));

    // もう一度押すと外れる
    await buy.click();
    await expect(row).not.toHaveClass(/row-selected/);
    await expect(selectedCount).toHaveText(String(before));
  });

  test('並び替えても「今回買う」の状態と件数は保たれる', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByTestId('candidate-P005').getByRole('button', { name: /今回買う/ }).click();
    await expect(page.getByTestId('candidate-P005')).toHaveClass(/row-selected/);

    await page.getByTestId('candidate-sort-name').click();
    await expect(page.getByTestId('candidate-P005')).toHaveClass(/row-selected/);
    await expect(page.getByTestId('candidate-P005').getByRole('button', { name: /今回買う/ })).toHaveText('✓ 今回買う');
  });

  test('「価格を登録」からその商品を選んだ状態で価格登録画面へ移動する', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByTestId('candidate-P005').getByRole('link', { name: '価格を登録' }).click();
    await expect(page).toHaveURL(/\/prices\/new\?product=P005/);
    await expect(page.getByTestId('price-result')).toContainText('やさしい麦茶');
  });

  test('見出しはキーボードでも操作できる', async ({ page }) => {
    await page.goto('/shopping');
    const button = page.getByTestId('candidate-sort-name');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('columnheader', { name: /商品名/ })).toHaveAttribute('aria-sort', 'ascending');
    await page.keyboard.press('Space');
    await expect(page.getByRole('columnheader', { name: /商品名/ })).toHaveAttribute('aria-sort', 'descending');
  });

  test('横スクロールが出ない', async ({ page }) => {
    await page.goto('/shopping');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('買い物候補（スマホはコンパクトなカードのまま）', () => {
  test.skip(({ isMobile }) => !isMobile, 'スマホ表示でのみ確認する');

  test('★スマホでは表ではなくカードで、重要な情報と操作が入っている', async ({ page }) => {
    await page.goto('/shopping');
    await expect(page.getByTestId('candidate-table')).toHaveCount(0);

    const card = page.getByTestId('candidate-P005');
    await expect(card).toContainText('やさしい麦茶');
    await expect(card).toContainText('最安店');
    await expect(card).toContainText('円/本');
    await expect(card.getByRole('button', { name: /今回買う/ })).toBeVisible();
    await expect(card.getByRole('link', { name: '価格を登録' })).toBeVisible();

    // 横スクロールしない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

// 第19回: 商品一覧をPCでは一覧表にして、見出しから並び替えられるようにする
test.describe('商品一覧の一覧表（PC）', () => {
  test.skip(({ isMobile }) => !!isMobile, 'PC表示でのみ確認する');

  const cells = (page: import('@playwright/test').Page, nth: number) =>
    page.getByTestId('product-list').locator(`> tr td:nth-child(${nth})`).allInnerTexts();

  test('★一覧表で全件が1行ずつ出て、必要な列がそろっている', async ({ page }) => {
    await page.goto('/products');
    const table = page.getByTestId('product-table');
    await expect(table).toBeVisible();
    for (const label of ['商品ID', '商品名', 'カテゴリ', '比較単位', '目安単価', '最安単価', '最終登録日', '操作']) {
      await expect(table.getByRole('columnheader', { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByTestId('product-list').locator('> tr')).toHaveCount(5);

    // サンプルの1行目（登録順のまま＝P001）
    const first = page.getByTestId('product-list').locator('> tr').first();
    await expect(first).toContainText('P001');
    await expect(first).toContainText('サランラップ');
    await expect(first).toContainText('日用品');
    await expect(first).toContainText('1本あたり'); // 比較単位
  });

  test('★商品IDは P1 → P2 → P10 の順（文字列順にならない）', async ({ page }) => {
    await page.goto('/products');
    // テスト用に商品を10件まで増やす（このテストのブラウザの中だけ）
    for (let i = 6; i <= 10; i += 1) {
      await page.getByRole('button', { name: '＋ 商品登録' }).click();
      const form = page.getByRole('form', { name: '商品登録' });
      await form.getByLabel('カテゴリ').fill('テスト');
      await form.getByLabel('品目').fill(`テスト商品${i}`);
      await form.getByLabel('基準数量').fill('1');
      await form.getByLabel('単位').fill('個');
      await form.getByRole('button', { name: '登録する' }).click();
      await expect(page.getByRole('status')).toContainText('を登録しました');
    }

    await page.getByTestId('product-sort-id').click();
    const ids = (await cells(page, 1)).map((t) => t.trim());
    expect(ids).toEqual(['P001', 'P002', 'P003', 'P004', 'P005', 'P006', 'P007', 'P008', 'P009', 'P010']);

    await page.getByTestId('product-sort-id').click();
    expect((await cells(page, 1)).map((t) => t.trim())).toEqual([
      'P010', 'P009', 'P008', 'P007', 'P006', 'P005', 'P004', 'P003', 'P002', 'P001',
    ]);
  });

  test('★商品名の昇順・降順（日本語の並び）と、元の並びへ戻せる', async ({ page }) => {
    await page.goto('/products');
    const before = await cells(page, 2);

    await page.getByTestId('product-sort-name').click();
    const asc = await cells(page, 2);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, 'ja')));
    await expect(page.getByRole('columnheader', { name: /商品名/ })).toHaveAttribute('aria-sort', 'ascending');

    await page.getByTestId('product-sort-name').click();
    expect(await cells(page, 2)).toEqual([...asc].reverse());
    await expect(page.getByRole('columnheader', { name: /商品名/ })).toHaveAttribute('aria-sort', 'descending');

    await page.getByTestId('product-sort-name').click();
    expect(await cells(page, 2)).toEqual(before);
    await expect(page.getByRole('columnheader', { name: /商品名/ })).toHaveAttribute('aria-sort', 'none');
  });

  test('★金額は数値として並ぶ（100 → 200 → 1000 の順）', async ({ page }) => {
    await page.goto('/products');
    const numbers = async (nth: number) =>
      (await cells(page, nth)).map((t) => (t.includes('—') ? null : Number(t.replace(/[^0-9.]/g, ''))));

    await page.getByTestId('product-sort-target').click();
    const target = (await numbers(5)).filter((v): v is number => v !== null);
    expect(target).toEqual([...target].sort((a, b) => a - b));

    await page.getByTestId('product-sort-cheapest').click();
    const cheapest = (await numbers(6)).filter((v): v is number => v !== null);
    expect(cheapest).toEqual([...cheapest].sort((a, b) => a - b));

    await page.getByTestId('product-sort-cheapest').click();
    const desc = (await numbers(6)).filter((v): v is number => v !== null);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  test('★値がない商品（価格未登録）が混ざっても壊れず、最後に並ぶ', async ({ page }) => {
    await page.goto('/products');
    // 価格履歴のない商品を1件追加する
    await page.getByRole('button', { name: '＋ 商品登録' }).click();
    const form = page.getByRole('form', { name: '商品登録' });
    await form.getByLabel('カテゴリ').fill('テスト');
    await form.getByLabel('品目').fill('価格未登録の商品');
    await form.getByLabel('基準数量').fill('1');
    await form.getByLabel('単位').fill('個');
    await form.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText('を登録しました');

    await page.getByTestId('product-sort-cheapest').click();
    expect((await cells(page, 2)).at(-1)).toContain('価格未登録の商品');
    await page.getByTestId('product-sort-cheapest').click(); // 降順でも最後
    expect((await cells(page, 2)).at(-1)).toContain('価格未登録の商品');
    // 件数は欠けない
    await expect(page.getByTestId('product-list').locator('> tr')).toHaveCount(6);
  });

  test('★カテゴリ・比較単位・最終登録日でも並び替えられる', async ({ page }) => {
    await page.goto('/products');
    for (const key of ['category', 'unit', 'lastDate']) {
      await page.getByTestId(`product-sort-${key}`).click();
      await expect(page.getByTestId('product-list').locator('> tr')).toHaveCount(5);
      await page.getByTestId(`product-sort-${key}`).click();
      await expect(page.getByTestId('product-list').locator('> tr')).toHaveCount(5);
      await page.getByTestId(`product-sort-${key}`).click();
    }
  });

  test('★検索で絞り込んだ結果に対しても並び替えできる', async ({ page }) => {
    await page.goto('/products');
    await page.getByLabel('商品を検索').fill('ラップ');
    await expect(page.getByTestId('product-list').locator('> tr')).toHaveCount(2);

    await page.getByTestId('product-sort-name').click();
    const asc = await cells(page, 2);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, 'ja')));
    await page.getByTestId('product-sort-name').click();
    expect(await cells(page, 2)).toEqual([...asc].reverse());
    // 絞り込みは保たれる
    await expect(page.getByTestId('product-list').locator('> tr')).toHaveCount(2);
  });

  test('★使用停止の絞り込みと並び替えが両立する', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('button', { name: 'やさしい麦茶を編集' }).click();
    const form = page.getByRole('form', { name: '商品の編集' });
    page.once('dialog', (d) => void d.accept());
    await form.getByRole('button', { name: '使用停止にする' }).click();
    await expect(page.getByRole('status')).toContainText('使用停止にしました');

    await page.getByRole('radio', { name: 'すべて' }).check();
    await page.getByTestId('product-sort-name').click();
    await expect(page.getByTestId('product-list').locator('> tr')).toHaveCount(5);
    await expect(page.getByTestId('product-P005')).toContainText('使用停止');
  });

  test('編集と削除保護が一覧表からも使える', async ({ page }) => {
    await page.goto('/products');
    await page.getByTestId('product-P005').getByRole('button', { name: 'やさしい麦茶を編集' }).click();
    const form = page.getByRole('form', { name: '商品の編集' });
    await expect(form).toBeVisible();
    // 価格履歴があるので削除できない（保護が働いている）
    await expect(form.getByTestId('delete-blocked')).toContainText('価格履歴');
    await expect(form.getByRole('button', { name: 'この商品を削除' })).toHaveCount(0);
  });

  test('見出しはキーボードでも操作でき、横スクロールも出ない', async ({ page }) => {
    await page.goto('/products');
    await page.getByTestId('product-sort-id').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('columnheader', { name: /商品ID/ })).toHaveAttribute('aria-sort', 'ascending');
    await page.keyboard.press('Space');
    await expect(page.getByRole('columnheader', { name: /商品ID/ })).toHaveAttribute('aria-sort', 'descending');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('商品一覧（スマホはカードのまま）', () => {
  test.skip(({ isMobile }) => !isMobile, 'スマホ表示でのみ確認する');

  test('★スマホでは表ではなくカードで、編集もできる', async ({ page }) => {
    await page.goto('/products');
    await expect(page.getByTestId('product-table')).toHaveCount(0);
    const card = page.getByTestId('product-P005');
    await expect(card).toContainText('やさしい麦茶');
    await expect(card).toContainText('目安単価');
    await expect(card.getByRole('button', { name: 'やさしい麦茶を編集' })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    // 下部ナビはそのまま
    await expect(page.getByTestId('bottom-nav')).toBeVisible();
  });
});

// 第20回: スマホのカード表示でも、何順に並んでいるか分かり、並び替えられるようにする
test.describe('買い物候補の並び替え（スマホ）', () => {
  test.skip(({ isMobile }) => !isMobile, 'スマホ表示でのみ確認する');

  const names = (page: import('@playwright/test').Page) =>
    page.getByTestId('candidate-list').locator('> li .item-card-title').allInnerTexts();
  const prices = async (page: import('@playwright/test').Page) => {
    const texts = await page.getByTestId('candidate-list').locator('> li dl > div:nth-child(2) dd').allInnerTexts();
    return texts.map((t) => Number(t.replace(/[^0-9.]/g, '')));
  };

  test('★並び替えUIが出て、最初は「お得な順（標準）」', async ({ page }) => {
    await page.goto('/shopping');
    const control = page.getByTestId('candidate-sort-control');
    await expect(control).toBeVisible();
    await expect(control).toContainText('並び替え');
    await expect(page.getByLabel('並び替え', { exact: true })).toHaveValue('');
    // 項目を選ぶまでは向きのボタンは使えない
    await expect(page.getByTestId('candidate-sort-direction')).toBeDisabled();
    await expect(page.getByTestId('candidate-sort-direction')).toContainText('並び順');
  });

  test('★最安単価を選ぶと「安い順」になり、押すと「高い順」に変わる', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByLabel('並び替え', { exact: true }).selectOption('unitPrice');

    const direction = page.getByTestId('candidate-sort-direction');
    await expect(direction).toContainText('安い順');
    const asc = await prices(page);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));

    await direction.click();
    await expect(direction).toContainText('高い順');
    const desc = await prices(page);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    // 画面の表示と実際の並びが食い違わない
    expect(desc[0]).toBeGreaterThanOrEqual(desc[desc.length - 1]);
  });

  test('★商品名など別の項目にも変えられ、文字の項目は「昇順／降順」と出る', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByLabel('並び替え', { exact: true }).selectOption('name');
    const direction = page.getByTestId('candidate-sort-direction');
    await expect(direction).toContainText('昇順');
    const asc = await names(page);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, 'ja')));

    await direction.click();
    await expect(direction).toContainText('降順');
    expect(await names(page)).toEqual([...asc].reverse());
  });

  test('「お得な順（標準）」に戻せる', async ({ page }) => {
    await page.goto('/shopping');
    const before = await names(page);
    await page.getByLabel('並び替え', { exact: true }).selectOption('name');
    expect(await names(page)).not.toEqual(before);
    await page.getByLabel('並び替え', { exact: true }).selectOption('');
    expect(await names(page)).toEqual(before);
    await expect(page.getByTestId('candidate-sort-direction')).toBeDisabled();
  });

  test('★並び替えても「今回買う」と「価格を登録」は今までどおり使える', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByLabel('並び替え', { exact: true }).selectOption('unitPrice');

    const card = page.getByTestId('candidate-P005');
    const buy = card.getByRole('button', { name: /今回買う/ });
    const selected = page.getByTestId('selected-count');
    const before = Number(await selected.innerText());

    await buy.click();
    await expect(buy).toHaveText('✓ 今回買う');
    await expect(selected).toHaveText(String(before + 1));
    await expect(card).toHaveClass(/card-selected/);

    // 並び替えを変えても選択は保たれる
    await page.getByLabel('並び替え', { exact: true }).selectOption('name');
    await expect(page.getByTestId('candidate-P005').getByRole('button', { name: /今回買う/ })).toHaveText('✓ 今回買う');

    await page.getByTestId('candidate-P005').getByRole('link', { name: '価格を登録' }).click();
    await expect(page).toHaveURL(/\/prices\/new\?product=P005/);
  });

  test('並び替えUIを使っても横スクロールが出ず、押しやすい大きさ', async ({ page }) => {
    await page.goto('/shopping');
    for (const value of ['', 'unitPrice', 'name', 'diff', 'selected']) {
      await page.getByLabel('並び替え', { exact: true }).selectOption(value);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    for (const testId of ['candidate-sort-direction']) {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const select = await page.getByLabel('並び替え', { exact: true }).boundingBox();
    expect(select!.height).toBeGreaterThanOrEqual(44);
    expect(select!.x + select!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
  });
});

test.describe('買い物候補の並び替え（PCには専用UIを出さない）', () => {
  test.skip(({ isMobile }) => !!isMobile, 'PC表示でのみ確認する');

  test('★PCではスマホ用の並び替えUIを出さず、見出しの並び替えがそのまま使える', async ({ page }) => {
    await page.goto('/shopping');
    await expect(page.getByTestId('candidate-sort-control')).toHaveCount(0);

    await page.getByTestId('candidate-sort-unitPrice').click();
    await expect(page.getByRole('columnheader', { name: /最安単価/ })).toHaveAttribute('aria-sort', 'ascending');
  });
});

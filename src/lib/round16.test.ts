import { describe, expect, it } from 'vitest';
import { createSampleData, mockPriceRecords, mockProducts, mockStores } from '../data/mockData';
import { loadAppData } from '../data/schema';
import type { PriceRecord, Product } from '../data/types';
import {
  buildCompareRows,
  buildShoppingCandidates,
  calcDiff,
  calcUnitPrice,
  describeRatio,
  priceReference,
  recentStoreIds,
  targetPriceFor,
  unusualPriceMessage,
  unusualPriceRatio,
} from './price';
import { buildShoppingList } from './shopping';
import { QUANTITY_ERROR, parseNumber, PRICE_MAX, QUANTITY_MAX, validatePriceForm } from './validation';

// 第16回: 普段使いの改善（入力チェック・単価計算の監査・打ち間違い対策・最近使ったお店・値札表示）

const record = (over: Partial<PriceRecord> & Pick<PriceRecord, 'id' | 'productId' | 'storeId' | 'quantity' | 'price' | 'seq'>): PriceRecord => ({
  date: '2026-09-25',
  createdAt: '2026-09-25T00:00:00.000Z',
  ...over,
});

describe('価格入力のチェック（許可する値・禁止する値）', () => {
  const ok = { date: '2026-09-22', productId: 'P005', storeId: 'S009', quantity: '6', price: '840', sale: false, note: '' };
  const priceError = (price: string) => validatePriceForm({ ...ok, price }).errors.price;
  const quantityError = (quantity: string) => validatePriceForm({ ...ok, quantity }).errors.quantity;

  it('ふつうの価格・全角・カンマ付きは許可する', () => {
    expect(priceError('840')).toBeUndefined();
    expect(priceError('８４０')).toBeUndefined();
    expect(priceError('1,698')).toBeUndefined();
    expect(priceError(String(PRICE_MAX))).toBeUndefined();
  });

  it('空欄・0円・負数は登録できない', () => {
    expect(priceError('')).toBe('販売価格を入力してください');
    expect(priceError('0')).toContain('0より大きい');
    expect(priceError('-100')).toContain('0より大きい');
    expect(priceError('－100')).toContain('0より大きい');
  });

  it('小数の価格は登録できない（円は1円単位）', () => {
    expect(priceError('99.5')).toContain('1円単位');
  });

  it('極端に大きい価格は打ち間違いとして登録できない', () => {
    expect(priceError(String(PRICE_MAX + 1))).toContain('大きすぎます');
    expect(priceError('99999999')).toContain('大きすぎます');
  });

  it('★数字でないもの（Infinity・1e3・0x10 など）は登録できない', () => {
    for (const bad of ['Infinity', '1e3', '1e400', '0x10', 'abc', '8 4 0', '840円']) {
      expect(priceError(bad), bad).toBe('販売価格は数字で入力してください');
    }
    expect(parseNumber('Infinity')).toBeNaN();
    expect(parseNumber('1e3')).toBeNaN();
  });

  // 第16回 追加修正：販売数量は「1本」「6本」「12個」のような個数なので、小数は入力ミスとして扱う
  it('★数量は1以上の整数だけ。小数・0・負数・空欄・極端に大きい値は登録できない', () => {
    for (const ok of ['1', '2', '6', '12', '24', '100', '１２']) expect(quantityError(ok)).toBeUndefined();
    for (const ng of ['0.5', '1.5', '2.3', '6.1', '０．５', '２．５']) expect(quantityError(ng)).toBe(QUANTITY_ERROR);
    expect(quantityError('0')).toBe(QUANTITY_ERROR);
    expect(quantityError('-1')).toBe(QUANTITY_ERROR);
    expect(quantityError('')).toBe('販売数量を入力してください');
    expect(quantityError(String(QUANTITY_MAX + 1))).toContain('大きすぎます');
    expect(quantityError('abc')).toBe('販売数量は数字で入力してください');
  });

  it('境界値：1円・上限ちょうど・数量1 は登録でき、上限+1円・数量0 はできない', () => {
    expect(priceError('1')).toBeUndefined();
    expect(priceError('1000000')).toBeUndefined();
    expect(priceError('1,000,000')).toBeUndefined();
    expect(priceError('1000001')).toContain('大きすぎます');
    expect(quantityError('1')).toBeUndefined();
    expect(quantityError(String(QUANTITY_MAX))).toBeUndefined();
    expect(quantityError('0')).toBe(QUANTITY_ERROR);
    expect(quantityError('0.0')).toBe(QUANTITY_ERROR); // 0.0 は 0 と同じ扱い
  });

  it('空白だけ・NaN という文字は「入力してください」「数字で」で区別する', () => {
    expect(priceError('   ')).toBe('販売価格を入力してください');
    expect(priceError('NaN')).toBe('販売価格は数字で入力してください');
  });

  it('既存の保存データの読み込み（互換性）は変わらない', () => {
    // 入力チェックを厳しくしても、保存済みデータの検証（schema）は今までどおり
    const data = createSampleData();
    expect(loadAppData(data).ok).toBe(true);
  });
});

describe('単価計算の監査', () => {
  const water: Product = { id: 'P101', category: '飲料', name: '天然水', unitAmount: 1, unit: 'L', targetUnitPrice: 50 };

  it('★値札が安くても内容量が少なければ、最安にしない', () => {
    // A店: 2L 120円（60円/L） / B店: 6L（2L×3）300円（50円/L）。値札はA店の方が安い
    const records = [
      record({ id: 'R101', productId: 'P101', storeId: 'S001', quantity: 2, price: 120, seq: 1 }),
      record({ id: 'R102', productId: 'P101', storeId: 'S002', quantity: 6, price: 300, seq: 2 }),
    ];
    const [row] = buildCompareRows([water], records);
    expect(row.cheapest?.storeId).toBe('S002');
    expect(row.cheapest?.unitPrice).toBe(50);
    expect(row.storePrices.map((p) => p.unitPrice)).toEqual([50, 60]);
  });

  it('基準数量が1以外（100gあたり など）でも、基準数量あたりで比べる', () => {
    const meat: Product = { id: 'P102', category: '食品', name: '鶏むね肉', unitAmount: 100, unit: 'g', targetUnitPrice: 70 };
    // 300g 198円 → 66円/100g、500g 350円 → 70円/100g
    const records = [
      record({ id: 'R103', productId: 'P102', storeId: 'S001', quantity: 300, price: 198, seq: 1 }),
      record({ id: 'R104', productId: 'P102', storeId: 'S002', quantity: 500, price: 350, seq: 2 }),
    ];
    const [row] = buildCompareRows([meat], records);
    expect(row.cheapest).toMatchObject({ storeId: 'S001', unitPrice: 66 });
    expect(row.targetDiff).toBe(-4);
  });

  it('サンプルの実データ相当（30cm×50m・2L×6本・1kg）でも正しい', () => {
    const rows = Object.fromEntries(buildCompareRows(mockProducts, mockPriceRecords).map((r) => [r.product.id, r]));
    // サランラップ 6本 2,598円 → 433円/本（1本 458円より安い）
    expect(rows.P001.cheapest).toMatchObject({ storeId: 'S001', unitPrice: 433 });
    // やさしい麦茶（2L×6本で1セット＝6本）: 6本 840円 → 140円/本
    expect(rows.P005.cheapest).toMatchObject({ storeId: 'S009', unitPrice: 140 });
    // つや姫: 5kg 2,980円 → 596円/kg（2kg 1,280円 = 640円/kg より安い）
    expect(rows.P004.cheapest).toMatchObject({ storeId: 'S001', unitPrice: 596 });
  });

  it('丸めは小数第2位。丸めた値どうしで正しく順位がつく', () => {
    expect(calcUnitPrice(100, 3)).toBe(33.33);
    expect(calcUnitPrice(200, 6)).toBe(33.33);
    expect(calcUnitPrice(1000, 7)).toBe(142.86);
    expect(calcDiff(33.33, 33.34)).toBe(-0.01);
  });

  it('目安単価ちょうどは「目安以下」として買い物候補に入る。1円でも高ければ入らない', () => {
    const p: Product = { id: 'P103', category: '日用品', name: 'テスト', unitAmount: 1, unit: '個', targetUnitPrice: 100 };
    const exact = buildCompareRows([p], [record({ id: 'R105', productId: 'P103', storeId: 'S001', quantity: 3, price: 300, seq: 1 })]);
    expect(buildShoppingCandidates(exact)).toHaveLength(1);
    const over = buildCompareRows([p], [record({ id: 'R106', productId: 'P103', storeId: 'S001', quantity: 3, price: 301, seq: 1 })]);
    expect(buildShoppingCandidates(over)).toHaveLength(0);
  });

  it('目安単価を、売られている数量での金額に直せる（値札と見比べる用）', () => {
    expect(targetPriceFor(160, 6)).toBe(960);
    expect(targetPriceFor(70, 300, 100)).toBe(210);
    expect(targetPriceFor(424.5, 3)).toBe(1273); // 1273.5 → 切り捨て（それ以下なら目安どおり）
    expect(targetPriceFor(null, 6)).toBeNull();
  });
});

describe('打ち間違いの確認（いつもの単価と大きく違うとき）', () => {
  const rows = Object.fromEntries(buildCompareRows(mockProducts, mockPriceRecords).map((r) => [r.product.id, r]));

  it('比べる基準は「同じ店の前回」→「現在の最安」→「目安単価」の順', () => {
    expect(priceReference(rows.P005, 'S002', 160)).toEqual({ unitPrice: 180, label: 'この店の前回' });
    expect(priceReference(rows.P005, 'S001', 160)).toEqual({ unitPrice: 140, label: '現在の最安' });
    expect(priceReference(null, 'S001', 160)).toEqual({ unitPrice: 160, label: '目安単価' });
    expect(priceReference(null, 'S001', null)).toBeNull();
  });

  it('★840円を8400円と打った（10倍）ときは確認を求める', () => {
    const ref = priceReference(rows.P005, 'S009', 160);
    const ratio = unusualPriceRatio(calcUnitPrice(8400, 6), ref);
    expect(ratio).toBe(10);
    expect(describeRatio(ratio!)).toBe('約10倍');
  });

  it('桁を1つ落とした（10分の1）ときも確認を求める', () => {
    const ratio = unusualPriceRatio(calcUnitPrice(84, 6), priceReference(rows.P005, 'S009', 160));
    expect(describeRatio(ratio!)).toBe('約10分の1');
  });

  it('ふつうの値上がり・値下がり（3倍未満）では確認しない', () => {
    const ref = priceReference(rows.P005, 'S009', 160);
    expect(unusualPriceRatio(calcUnitPrice(1020, 6), ref)).toBeNull();
    expect(unusualPriceRatio(calcUnitPrice(600, 6), ref)).toBeNull();
  });

  it('比べるものがない（初めての商品で目安もない）ときは確認しない', () => {
    expect(unusualPriceRatio(100, null)).toBeNull();
  });

  it('★新規登録と修正で同じ判定を使う。修正では修正前の自分自身とは比べない', () => {
    const tea = mockProducts.find((p) => p.id === 'P005')!;
    // 新規：ミスターマックスの前回（R010: 140円/本）と比べて10倍
    expect(unusualPriceMessage(tea, 'S009', 1400, mockPriceRecords)).toContain('この店の前回（140円/本）の約10倍');
    // 修正：R010 自身を8400円→840円に直すとき、修正前の8400円と比べて「10分の1」と誤って注意しない
    const typo = mockPriceRecords.map((r) => (r.id === 'R010' ? { ...r, price: 8400 } : r));
    expect(unusualPriceMessage(tea, 'S009', 140, typo, 'R010')).toBeNull();
    // 修正で桁を間違えたときは、同じ店のほかの記録（R001: 150円/本）と比べて注意する
    expect(unusualPriceMessage(tea, 'S009', 1400, mockPriceRecords, 'R010')).toContain('この店の前回（150円/本）');
  });
});

describe('最近使ったお店', () => {
  it('新しく登録した順に、重複なく、最大件数まで', () => {
    // サンプル: 最後が S009（seq 10）、その前の S001 が 4件、その前が S003
    expect(recentStoreIds(mockPriceRecords, mockStores, 3)).toEqual(['S009', 'S001', 'S003']);
    expect(recentStoreIds(mockPriceRecords, mockStores, 1)).toEqual(['S009']);
  });

  it('使用停止の店舗は出さない', () => {
    const stores = mockStores.map((s) => (s.id === 'S009' ? { ...s, archived: true } : s));
    expect(recentStoreIds(mockPriceRecords, stores, 3)).toEqual(['S001', 'S003', 'S002']);
  });

  it('記録がなければ空', () => {
    expect(recentStoreIds([], mockStores, 3)).toEqual([]);
  });
});

describe('買い物リストの値札表示', () => {
  it('最安店での実際の価格・数量と、いくら以下なら目安どおりかを持つ', () => {
    const data = createSampleData();
    data.shoppingList = ['P005', 'P002'];
    const items = buildShoppingList(data).groups.flatMap((g) => g.items);
    const tea = items.find((i) => i.product.id === 'P005')!;
    // やさしい麦茶: ミスターマックス 6本 840円、目安 160円/本 → 6本で960円以下
    expect(tea).toMatchObject({ storeId: 'S009', unitPrice: 140, shelf: { price: 840, quantity: 6 }, buyBelow: 960 });
    const wrap = items.find((i) => i.product.id === 'P002')!;
    // クレラップ: コストコ 4本 1,698円、目安 430円/本 → 4本で1,720円以下
    expect(wrap).toMatchObject({ shelf: { price: 1698, quantity: 4 }, buyBelow: 1720 });
  });

  it('価格の記録がない商品は値札も目安金額もなし', () => {
    const data = createSampleData();
    data.products.push({ id: 'P006', category: 'テスト', name: '記録なし', unitAmount: 1, unit: '個', targetUnitPrice: 100 });
    data.shoppingList = ['P006'];
    const [item] = buildShoppingList(data).groups[0].items;
    expect(item).toMatchObject({ shelf: null, buyBelow: null, unitPrice: null });
  });
});

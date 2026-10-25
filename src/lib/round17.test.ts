import { describe, expect, it } from 'vitest';
import { mockPriceRecords, mockProducts, mockStores } from '../data/mockData';
import type { PriceRecord, Product } from '../data/types';
import { calcUnitPrice, perUnitPrice, recentProductIds, recentStoreIds, unitPriceLabel } from './price';

// 第17回: 店頭で素早く登録するための「最近使った商品」。
// 専用のデータは持たず、価格履歴から求める（保存データの形は変えない）。

const record = (over: Partial<PriceRecord> & Pick<PriceRecord, 'id' | 'productId' | 'storeId' | 'seq'>): PriceRecord => ({
  date: '2026-09-25',
  quantity: 1,
  price: 100,
  createdAt: '2026-09-25T00:00:00.000Z',
  ...over,
});

describe('最近価格を登録した商品', () => {
  it('新しい順（登録順の番号が大きい順）に返す', () => {
    const records = [
      record({ id: 'R001', productId: 'P001', storeId: 'S001', seq: 1 }),
      record({ id: 'R002', productId: 'P002', storeId: 'S001', seq: 2 }),
      record({ id: 'R003', productId: 'P003', storeId: 'S001', seq: 3 }),
    ];
    expect(recentProductIds(records, mockProducts, 3)).toEqual(['P003', 'P002', 'P001']);
  });

  it('★最大3件まで（4件以上登録していても3件）', () => {
    const records = [1, 2, 3, 4, 5].map((n) =>
      record({ id: `R00${n}`, productId: `P00${n}`, storeId: 'S001', seq: n }),
    );
    expect(recentProductIds(records, mockProducts, 3)).toEqual(['P005', 'P004', 'P003']);
  });

  it('★同じ商品は1回だけ（重複しない）', () => {
    const records = [
      record({ id: 'R001', productId: 'P001', storeId: 'S001', seq: 1 }),
      record({ id: 'R002', productId: 'P005', storeId: 'S002', seq: 2 }),
      record({ id: 'R003', productId: 'P005', storeId: 'S003', seq: 3 }), // 同じ商品をもう一度
    ];
    expect(recentProductIds(records, mockProducts, 3)).toEqual(['P005', 'P001']);
  });

  it('★使用停止にした商品は候補に出さない', () => {
    const products: Product[] = mockProducts.map((p) => (p.id === 'P005' ? { ...p, archived: true } : p));
    const records = [
      record({ id: 'R001', productId: 'P001', storeId: 'S001', seq: 1 }),
      record({ id: 'R002', productId: 'P005', storeId: 'S001', seq: 2 }),
    ];
    expect(recentProductIds(records, products, 3)).toEqual(['P001']);
  });

  it('★削除された商品（商品一覧にないID）は候補に出さない', () => {
    const records = [
      record({ id: 'R001', productId: 'P001', storeId: 'S001', seq: 1 }),
      record({ id: 'R002', productId: 'P900', storeId: 'S001', seq: 2 }), // すでに無い商品
    ];
    expect(recentProductIds(records, mockProducts, 3)).toEqual(['P001']);
  });

  it('価格履歴がなければ空（画面では「最近：」自体を出さない）', () => {
    expect(recentProductIds([], mockProducts, 3)).toEqual([]);
  });

  it('サンプルデータでは、最後に登録した3商品が新しい順に出る', () => {
    expect(recentProductIds(mockPriceRecords, mockProducts, 3)).toEqual(['P005', 'P004', 'P003']);
  });
});

describe('最近使ったお店（第16回の仕様を維持しているか）', () => {
  it('新しい順・重複なし・最大3件', () => {
    expect(recentStoreIds(mockPriceRecords, mockStores, 3)).toEqual(['S009', 'S001', 'S003']);
  });

  it('使用停止の店舗は候補に出さない', () => {
    const stores = mockStores.map((s) => (s.id === 'S009' ? { ...s, archived: true } : s));
    expect(recentStoreIds(mockPriceRecords, stores, 3)).not.toContain('S009');
  });

  it('削除された店舗（店舗一覧にないID）は候補に出さない', () => {
    const records = [record({ id: 'R001', productId: 'P001', storeId: 'S900', seq: 1 })];
    expect(recentStoreIds(records, mockStores, 3)).toEqual([]);
  });

  it('商品の候補と店舗の候補は互いに影響しない（同じ履歴から別々に求める）', () => {
    const records = [
      record({ id: 'R001', productId: 'P001', storeId: 'S001', seq: 1 }),
      record({ id: 'R002', productId: 'P002', storeId: 'S002', seq: 2 }),
    ];
    expect(recentProductIds(records, mockProducts, 3)).toEqual(['P002', 'P001']);
    expect(recentStoreIds(records, mockStores, 3)).toEqual(['S002', 'S001']);
  });
});

// 第21回: 基準数量が2以上の商品で、単価の意味が分かるようにする
describe('単価の単位の書き方と、参考の1単位あたり', () => {
  it('★基準数量が1なら、これまでどおり「円/本」', () => {
    expect(unitPriceLabel('本', 1)).toBe('円/本');
    expect(unitPriceLabel('kg', 1)).toBe('円/kg');
  });

  it('★基準数量が2以上なら「円/12袋」と書く（1袋の値段と取り違えないため）', () => {
    expect(unitPriceLabel('袋', 12)).toBe('円/12袋');
    expect(unitPriceLabel('本', 6)).toBe('円/6本');
  });

  it('単位が無いときは「円」だけ', () => {
    expect(unitPriceLabel(undefined, 12)).toBe('円');
  });

  it('★参考の1単位あたりを出す（12袋あたり997円 → 1袋あたり83.08円）', () => {
    expect(perUnitPrice(997, 12)).toBe(83.08);
    expect(perUnitPrice(1798, 12)).toBe(149.83);
  });

  it('基準数量が1のときは参考単価を出さない（同じ値をくり返さない）', () => {
    expect(perUnitPrice(140, 1)).toBeNull();
    expect(perUnitPrice(140)).toBeNull();
  });

  it('金額が無いときは参考単価も無い', () => {
    expect(perUnitPrice(null, 12)).toBeNull();
  });

  it('既存の単価計算は変えていない（12袋997円 → 12袋あたり997円）', () => {
    expect(calcUnitPrice(997, 12, 12)).toBe(997);
    expect(calcUnitPrice(840, 6, 1)).toBe(140);
  });
});

import { describe, expect, it } from 'vitest';
import { mockPriceRecords, mockProducts } from '../data/mockData';
import type { PriceRecord } from '../data/types';
import { buildCompareRows, buildHistory, buildShoppingCandidates, calcDiff, calcUnitPrice } from './price';

describe('calcUnitPrice', () => {
  it('やさしい麦茶 6本 840円 → 1本あたり140円', () => {
    expect(calcUnitPrice(840, 6)).toBe(140);
  });
  it('端数は小数第2位で丸める', () => {
    expect(calcUnitPrice(1698, 4)).toBe(424.5);
    expect(calcUnitPrice(1000, 3)).toBe(333.33);
  });
  it('数量0や未入力は計算しない', () => {
    expect(calcUnitPrice(840, 0)).toBeNull();
    expect(calcUnitPrice(Number.NaN, 6)).toBeNull();
  });
});

describe('calcDiff', () => {
  it('目安より安ければマイナス（浮動小数の誤差なし）', () => {
    expect(calcDiff(140, 160)).toBe(-20);
    expect(calcDiff(199.8, 200)).toBe(-0.2);
  });
  it('目安単価が未設定なら null', () => {
    expect(calcDiff(140, null)).toBeNull();
  });
});

describe('価格比較（Excel版と同じ結果になること）', () => {
  const rows = buildCompareRows(mockProducts, mockPriceRecords);
  const byId = Object.fromEntries(rows.map((r) => [r.product.id, r]));

  it('各商品の最安店・最安単価・目安との差', () => {
    expect(byId.P001.cheapest?.storeId).toBe('S001');
    expect(byId.P001.cheapest?.unitPrice).toBe(433);
    expect(byId.P001.targetDiff).toBe(3);
    expect(byId.P002.cheapest?.unitPrice).toBe(424.5);
    expect(byId.P002.targetDiff).toBe(-5.5);
    expect(byId.P003.cheapest?.unitPrice).toBe(199.8);
    expect(byId.P004.cheapest?.unitPrice).toBe(596);
    expect(byId.P005.cheapest?.storeId).toBe('S009');
    expect(byId.P005.cheapest?.unitPrice).toBe(140);
    expect(byId.P005.targetDiff).toBe(-20);
  });

  it('同じ店舗は最新の記録だけを比較に使う', () => {
    // ミスターマックスは 8/30 に 150円、9/22 に 140円 → 140円を使う
    const mrmax = byId.P005.storePrices.filter((s) => s.storeId === 'S009');
    expect(mrmax).toHaveLength(1);
    expect(mrmax[0].unitPrice).toBe(140);
  });

  it('買い物候補は目安以下の4件を、お得な順に並べる', () => {
    const ids = buildShoppingCandidates(rows).map((r) => r.product.id);
    expect(ids).toEqual(['P005', 'P002', 'P004', 'P003']);
  });
});

describe('価格履歴', () => {
  const tea = mockProducts.find((p) => p.id === 'P005')!;

  it('現在・前回・過去最安・過去最高・件数', () => {
    const h = buildHistory(tea, mockPriceRecords);
    expect(h.count).toBe(4);
    expect(h.current?.unitPrice).toBe(140);
    expect(h.previous?.unitPrice).toBe(158);
    expect(h.lowest?.unitPrice).toBe(140);
    expect(h.highest?.unitPrice).toBe(180);
  });

  it('商品名ではなく商品IDで紐付ける（名前を変えても履歴が残る）', () => {
    const renamed = { ...tea, name: '別の名前に変更' };
    expect(buildHistory(renamed, mockPriceRecords).count).toBe(4);
  });

  it('記録がない商品は空', () => {
    const empty: PriceRecord[] = [];
    const h = buildHistory(tea, empty);
    expect(h.count).toBe(0);
    expect(h.current).toBeNull();
  });
});

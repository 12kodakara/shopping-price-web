import { describe, expect, it } from 'vitest';
import { largeData } from '../tests/fixtures/largeData';
import { createRepository, STORAGE_KEY, type StorageLike } from './data/repository';
import { parseAppData } from './data/schema';
import type { AppData } from './data/types';
import { buildCompareRows, buildHistory, compareRecordsOldestFirst, compareTargets } from './lib/price';
import { EMPTY_RECORD_FILTER, filterRecords, productMatches } from './lib/search';
import { buildShoppingList } from './lib/shopping';

// 大量データでの処理時間の確認（第6回）。
// 画面の描画を除いた「計算だけ」の時間を測る。遅い環境でも落ちにくいよう、上限は余裕を持たせている。
// 実測値はテスト名の横に出力する（npm test -- src/perf.test.ts で確認できる）。

function time<T>(fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

const report: string[] = [];
const log = (label: string, ms: number) => report.push(`${label}: ${ms.toFixed(1)}ms`);

describe('大量データでの処理時間', () => {
  const cases = [
    { products: 100, stores: 100, records: 1000 },
    { products: 500, stores: 100, records: 1000 },
    { products: 1000, stores: 100, records: 1000 },
    { products: 1000, stores: 100, records: 5000 },
  ];

  for (const c of cases) {
    it(`商品${c.products}・店舗${c.stores}・価格履歴${c.records}`, () => {
      const data = largeData(c) as AppData;
      const label = `[P${c.products}/S${c.stores}/R${c.records}]`;
      const names = {
        product: (id: string) => data.products.find((p) => p.id === id)?.name,
        store: (id: string) => data.stores.find((s) => s.id === id)?.name,
      };

      const json = JSON.stringify(data);
      const parse = time(() => parseAppData(json));
      expect(parse.value.ok).toBe(true);
      log(`${label} 保存データの読み込み・検証 (${(json.length / 1024).toFixed(0)}KB)`, parse.ms);

      const compare = time(() => {
        const t = compareTargets(data);
        return buildCompareRows(t.products, t.records);
      });
      expect(compare.value).toHaveLength(c.products);
      log(`${label} 価格比較の計算`, compare.ms);

      log(`${label} 買い物リストの組み立て`, time(() => buildShoppingList(data)).ms);
      log(`${label} 商品検索（1文字）`, time(() => data.products.filter((p) => productMatches(p, '牛'))).ms);
      log(`${label} 全記録の並べ替え`, time(() => [...data.priceRecords].sort(compareRecordsOldestFirst)).ms);
      const search = time(() => filterRecords(data.priceRecords, { ...EMPTY_RECORD_FILTER, query: 'テスト店 01' }, names));
      log(`${label} 価格履歴の検索`, search.ms);
      log(`${label} 価格履歴の期間絞り込み`, time(() => filterRecords(data.priceRecords, { query: '', from: '2026-01-01', to: '2026-03-31' }, names)).ms);
      log(`${label} 1商品の履歴集計`, time(() => buildHistory(data.products[0], data.priceRecords)).ms);

      // 1回の保存（読み直し・検証・書き込み）にかかる時間
      const storage: StorageLike = new Map() as unknown as StorageLike;
      const map = new Map<string, string>([[STORAGE_KEY, json]]);
      Object.assign(storage, {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
      });
      const repo = createRepository(storage);
      log(`${label} 購入済みチェック1回の保存`, time(() => repo.setShoppingSelected('P001', true)).ms);

      // 目安: どれも1秒を大きく下回ること（実測はさらに小さい）
      expect(compare.ms).toBeLessThan(1000);
      expect(search.ms).toBeLessThan(1000);
      expect(parse.ms).toBeLessThan(1000);
    });
  }

  it('計測結果', () => {
    console.log(`\n--- 計測結果 ---\n${report.join('\n')}\n`);
    expect(report.length).toBeGreaterThan(0);
  });
});

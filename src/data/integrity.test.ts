import { describe, expect, it } from 'vitest';
import { createSampleData } from './mockData';
import { createRepository, STORAGE_KEY, type StorageLike } from './repository';
import { loadAppData } from './schema';
import type { AppData } from './types';

// 第16回: データ整合性の確認。
// 読み込み時の検証（schema.validateCurrent）が不整合を見つけ、データを消さずに「壊れている」と扱うこと、
// また通常の操作（削除）では不整合が生まれないことを、項目ごとに確かめる。

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const broken = (change: (d: AppData) => void): AppData => {
  const d = createSampleData();
  change(d);
  return d;
};

describe('読み込み時に不整合を見つける', () => {
  const cases: [string, AppData, string][] = [
    ['存在しない商品を参照する価格履歴', broken((d) => (d.priceRecords[0].productId = 'P999')), 'P999'],
    ['存在しない店舗を参照する価格履歴', broken((d) => (d.priceRecords[0].storeId = 'S999')), 'S999'],
    ['商品IDの重複', broken((d) => (d.products[1].id = 'P001')), '重複'],
    ['店舗IDの重複', broken((d) => (d.stores[1].id = 'S001')), '重複'],
    ['価格記録IDの重複', broken((d) => (d.priceRecords[1].id = 'R001')), '重複'],
    ['不正な価格（0円）', broken((d) => (d.priceRecords[0].price = 0)), '販売価格'],
    ['不正な価格（負数）', broken((d) => (d.priceRecords[0].price = -1)), '販売価格'],
    ['不正な数量（0）', broken((d) => (d.priceRecords[0].quantity = 0)), '販売数量'],
    ['買い物リストに存在しない商品', broken((d) => (d.shoppingList = ['P999'])), '買い物リスト'],
  ];

  for (const [label, data, keyword] of cases) {
    it(`${label}は読み込まない（理由を返す）`, () => {
      const result = loadAppData(data);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain(keyword);
    });
  }

  it('★保存データに不整合があっても、消さずに残し「壊れている」と表示する', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify(broken((d) => (d.priceRecords[0].productId = 'P999')));
    storage.setItem(STORAGE_KEY, raw);
    const repo = createRepository(storage);
    expect(repo.getSnapshot().status.kind).toBe('corrupt');
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    // 壊れている間は書き込みもしない
    expect(repo.addStore({ name: 'テスト' }).ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('JSON では保存できない値（Infinity → null）も不正な価格として見つける', () => {
    const d = JSON.parse(JSON.stringify(broken((x) => (x.priceRecords[0].price = Number.POSITIVE_INFINITY))));
    expect(loadAppData(d).ok).toBe(false);
  });
});

describe('通常の操作では不整合が生まれない', () => {
  const fresh = () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(createSampleData()));
    return { storage, repo: createRepository(storage) };
  };
  const stored = (s: MemoryStorage): AppData => JSON.parse(s.getItem(STORAGE_KEY)!);

  it('価格履歴のある商品・店舗は削除できない（孤立した価格履歴を作らない）', () => {
    const { storage, repo } = fresh();
    expect(repo.deleteProduct('P005').ok).toBe(false);
    expect(repo.deleteStore('S009').ok).toBe(false);
    expect(loadAppData(stored(storage)).ok).toBe(true);
  });

  it('価格履歴のない商品を削除すると、買い物リスト・購入済みからも外れる', () => {
    const { storage, repo } = fresh();
    const added = repo.addProduct({ category: 'テスト', name: '一時的な商品', unitAmount: 1, unit: '個', targetUnitPrice: null });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    repo.setShoppingSelected(added.value.id, true);
    repo.setPurchased(added.value.id, true);
    expect(repo.deleteProduct(added.value.id).ok).toBe(true);
    const d = stored(storage);
    expect(d.shoppingList).not.toContain(added.value.id);
    expect(d.purchased).not.toContain(added.value.id);
    expect(loadAppData(d).ok).toBe(true);
  });

  it('価格履歴のない店舗を削除しても、データは整合したまま', () => {
    const { storage, repo } = fresh();
    expect(repo.deleteStore('S005').ok).toBe(true); // ドラッグストア（記録なし）
    expect(loadAppData(stored(storage)).ok).toBe(true);
  });

  it('価格記録を削除しても、商品・店舗・買い物リストはそのまま', () => {
    const { storage, repo } = fresh();
    expect(repo.deletePriceRecord('R010').ok).toBe(true);
    const d = stored(storage);
    expect(d.products).toHaveLength(5);
    expect(d.stores).toHaveLength(9);
    expect(d.priceRecords).toHaveLength(9);
    expect(loadAppData(d).ok).toBe(true);
  });
});

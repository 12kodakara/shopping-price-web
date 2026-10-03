import { describe, expect, it } from 'vitest';
import { createSampleData } from './mockData';
import { createRepository, STORAGE_KEY, type StorageLike } from './repository';
import { calcUnitPrice } from '../lib/price';
import { isValidQuantity, QUANTITY_ERROR } from '../lib/validation';
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

// 第16回 追加修正：販売数量は1以上の整数だけ（保存の直前でも確かめる）
describe('販売数量は1以上の整数だけ保存できる', () => {
  const base = { date: '2026-09-23', productId: 'P005', storeId: 'S009', sale: false };
  /** サンプルデータから始める（この中だけの保存先。実データには触れない） */
  const fresh = () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(createSampleData()));
    return { storage, repo: createRepository(storage) };
  };

  it('★1・6・100 は登録できる', () => {
    const { repo } = fresh();
    for (const quantity of [1, 6, 100]) {
      const result = repo.addPriceRecord({ ...base, quantity, price: 840 });
      expect(result.ok, `数量 ${quantity}`).toBe(true);
    }
  });

  it('★0・-1・0.5・1.5・2.3 は登録できず、保存データも増えない', () => {
    const { repo } = fresh();
    const before = repo.getSnapshot().data!.priceRecords.length;
    for (const quantity of [0, -1, 0.5, 1.5, 2.3]) {
      const result = repo.addPriceRecord({ ...base, quantity, price: 840 });
      expect(result.ok, `数量 ${quantity}`).toBe(false);
      expect(result.ok === false && result.error).toBe(QUANTITY_ERROR);
    }
    expect(repo.getSnapshot().data!.priceRecords).toHaveLength(before);
  });

  it('空欄（数値にならない）も登録できない', () => {
    const { repo } = fresh();
    const result = repo.addPriceRecord({ ...base, quantity: Number.NaN, price: 840 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('販売数量を入力してください');
  });

  it('★価格履歴の修正でも、小数へは変更できない（元の記録はそのまま）', () => {
    const { repo } = fresh();
    const added = repo.addPriceRecord({ ...base, quantity: 6, price: 840 });
    expect(added.ok).toBe(true);
    const id = added.ok ? added.value.id : '';

    const updated = repo.updatePriceRecord(id, { ...base, quantity: 1.5, price: 840 });
    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toBe(QUANTITY_ERROR);
    expect(repo.getSnapshot().data!.priceRecords.find((r) => r.id === id)?.quantity).toBe(6);
  });

  it('★数量1.5・価格840 では単価560円を有効な値として扱わない', () => {
    // 画面は isValidQuantity で単価を出すかどうかを決めている
    expect(isValidQuantity(1.5)).toBe(false);
    expect(calcUnitPrice(840, 1.5)).toBe(560); // 計算そのものはできてしまうので、
    expect(isValidQuantity(1.5) ? calcUnitPrice(840, 1.5) : null).toBeNull(); // 画面では出さない
    expect(isValidQuantity(6) ? calcUnitPrice(840, 6) : null).toBe(140); // 正しい入力なら 140円/本
  });
});

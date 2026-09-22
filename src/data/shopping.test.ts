import { beforeEach, describe, expect, it } from 'vitest';
import { buildShoppingList } from '../lib/shopping';
import { createSampleData } from './mockData';
import { createRepository, STORAGE_KEY, type StorageLike } from './repository';
import { parseAppData } from './schema';
import type { AppData } from './types';

// 第4回: 買い物リストの購入済み状態

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

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});
const stored = (): AppData => JSON.parse(storage.getItem(STORAGE_KEY)!);

/** 第3回までの形式（purchased がない）の保存データ */
function legacyData(shoppingList: string[] = ['P005', 'P002']): string {
  const d: Partial<AppData> = createSampleData();
  delete d.purchased;
  d.shoppingList = shoppingList;
  return JSON.stringify(d);
}

describe('既存データとの互換性', () => {
  it('purchased がない第3回までの保存データでも正常に起動し、全て未購入として扱う', () => {
    storage.setItem(STORAGE_KEY, legacyData());
    const repo = createRepository(storage);
    expect(repo.getSnapshot().status.kind).toBe('ready');
    expect(repo.getSnapshot().data!.purchased).toEqual([]);
    expect(repo.getSnapshot().data!.shoppingList).toEqual(['P005', 'P002']);
    // 読み込んだだけでは保存データを書き換えない
    expect(storage.getItem(STORAGE_KEY)).toBe(legacyData());
  });

  it('既存データのまま購入済みにでき、以後は purchased 付きで保存される', () => {
    storage.setItem(STORAGE_KEY, legacyData());
    const repo = createRepository(storage);
    expect(repo.setPurchased('P005', true).ok).toBe(true);
    expect(stored().purchased).toEqual(['P005']);
    expect(stored().shoppingList).toEqual(['P005', 'P002']);
    expect(stored().version).toBe(1);
  });

  it('purchased がない第3回のバックアップも復元できる', () => {
    const repo = createRepository(storage);
    const p = repo.previewRestore(legacyData(['P001']));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.summary).toMatchObject({ shoppingList: 1, purchased: 0 });
    expect(repo.restore(p.value.data).ok).toBe(true);
    expect(stored().purchased).toEqual([]);
  });

  it('リストにない商品の購入済み・重複は読み込み時に取り除く（データは壊れていない扱い）', () => {
    const d = createSampleData();
    d.shoppingList = ['P005'];
    d.purchased = ['P005', 'P005', 'P001'];
    const parsed = parseAppData(JSON.stringify(d));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.purchased).toEqual(['P005']);
  });

  const invalid: [string, (d: AppData) => void][] = [
    ['purchased が配列でない', (d) => ((d as { purchased: unknown }).purchased = 'P005')],
    ['purchased に文字列以外', (d) => ((d as { purchased: unknown }).purchased = [5])],
    ['purchased に存在しない商品', (d) => (d.purchased = ['P999'])],
  ];
  for (const [label, mutate] of invalid) {
    it(`不正な購入済み情報は拒否する：${label}`, () => {
      const d = createSampleData();
      d.shoppingList = ['P005'];
      mutate(d);
      expect(parseAppData(JSON.stringify(d)).ok).toBe(false);
    });
  }
});

describe('購入済みの操作', () => {
  it('購入済みにする・未購入に戻す（再読み込み後も維持）', () => {
    const repo = createRepository(storage);
    repo.addAllToShoppingList(['P005', 'P002', 'P004']);
    expect(repo.setPurchased('P002', true).ok).toBe(true);
    expect(createRepository(storage).getSnapshot().data!.purchased).toEqual(['P002']);
    expect(repo.setPurchased('P002', false).ok).toBe(true);
    expect(createRepository(storage).getSnapshot().data!.purchased).toEqual([]);
  });

  it('購入済みの並びは買い物リストの順（チェックの順番によらない）', () => {
    const repo = createRepository(storage);
    repo.addAllToShoppingList(['P005', 'P002', 'P004']);
    repo.setPurchased('P004', true);
    repo.setPurchased('P005', true);
    expect(stored().purchased).toEqual(['P005', 'P004']);
  });

  it('買い物リストにない商品は購入済みにできない', () => {
    const repo = createRepository(storage);
    expect(repo.setPurchased('P001', true).ok).toBe(false);
    expect(stored().purchased).toEqual([]);
  });

  it('リストから外すと購入済みも外れる', () => {
    const repo = createRepository(storage);
    repo.addAllToShoppingList(['P005', 'P002']);
    repo.setPurchased('P005', true);
    repo.setShoppingSelected('P005', false);
    expect(stored().shoppingList).toEqual(['P002']);
    expect(stored().purchased).toEqual([]);
  });

  it('すべて未購入に戻しても、リストの中身は残る', () => {
    const repo = createRepository(storage);
    repo.addAllToShoppingList(['P005', 'P002']);
    repo.setPurchased('P005', true);
    repo.setPurchased('P002', true);
    expect(repo.resetPurchased().ok).toBe(true);
    expect(stored().purchased).toEqual([]);
    expect(stored().shoppingList).toEqual(['P005', 'P002']);
  });

  it('まとめて追加は重複せず、存在しない商品は無視する', () => {
    const repo = createRepository(storage);
    repo.setShoppingSelected('P002', true);
    repo.addAllToShoppingList(['P005', 'P002', 'P999']);
    expect(stored().shoppingList).toEqual(['P002', 'P005']);
  });

  it('購入済みの状態はバックアップ・復元で保たれる', () => {
    const repo = createRepository(storage);
    repo.addAllToShoppingList(['P005', 'P002']);
    repo.setPurchased('P002', true);
    const b = repo.createBackup();
    if (!b.ok) throw new Error();
    expect(JSON.parse(b.value.json).purchased).toEqual(['P002']);
    repo.resetToSample();
    const p = repo.previewRestore(b.value.json);
    if (!p.ok) throw new Error(p.error);
    expect(p.value.summary).toMatchObject({ shoppingList: 2, purchased: 1 });
    repo.restore(p.value.data);
    expect(stored().purchased).toEqual(['P002']);
  });
});

describe('買い物リストの組み立て（店舗ごと・進捗）', () => {
  function listOf(mutate: (d: AppData) => void) {
    const d = createSampleData();
    mutate(d);
    return buildShoppingList(d);
  }

  it('最安店ごとにまとめ、店舗の並びは店舗一覧の順', () => {
    const list = listOf((d) => {
      d.shoppingList = ['P005', 'P002', 'P004'];
    });
    expect(list.groups.map((g) => [g.storeId, g.items.map((i) => i.product.id)])).toEqual([
      ['S001', ['P002', 'P004']], // コストコ
      ['S009', ['P005']], // ミスターマックス
    ]);
    expect(list.progress).toEqual({ total: 3, purchased: 0, remaining: 3 });
  });

  it('進捗件数（購入済み・残り）', () => {
    const list = listOf((d) => {
      d.shoppingList = ['P005', 'P002', 'P004'];
      d.purchased = ['P004'];
    });
    expect(list.progress).toEqual({ total: 3, purchased: 1, remaining: 2 });
    expect(list.groups[0].items.find((i) => i.product.id === 'P004')?.purchased).toBe(true);
  });

  it('価格履歴がない商品は「店舗未定」にまとめ、最後に表示する', () => {
    const list = listOf((d) => {
      d.products.push({ id: 'P006', category: '日用品', name: 'ティッシュ', unitAmount: 1, unit: '箱', targetUnitPrice: null });
      d.shoppingList = ['P006', 'P005'];
    });
    expect(list.groups.map((g) => g.storeId)).toEqual(['S009', null]);
    const item = list.groups[1].items[0];
    expect(item.product.id).toBe('P006');
    expect(item.unitPrice).toBeNull();
    expect(item.isCandidate).toBe(false);
  });

  it('使用停止の店舗の価格は使わず、次に安い店にまとめる', () => {
    const list = listOf((d) => {
      d.stores.find((s) => s.id === 'S009')!.archived = true;
      d.shoppingList = ['P005'];
    });
    expect(list.groups[0].storeId).toBe('S003'); // ドン・キホーテ 158円
    expect(list.groups[0].items[0].unitPrice).toBe(158);
  });

  it('使用停止の商品はリストに出さない（データは残す）', () => {
    const list = listOf((d) => {
      d.products.find((p) => p.id === 'P005')!.archived = true;
      d.shoppingList = ['P005', 'P002'];
      d.purchased = ['P005'];
    });
    expect(list.progress).toEqual({ total: 1, purchased: 0, remaining: 1 });
  });

  it('目安を超えた商品もリストには残し、候補外として示す', () => {
    const list = listOf((d) => {
      d.shoppingList = ['P001']; // サランラップ 433円（目安430円）
    });
    expect(list.groups[0].items[0]).toMatchObject({ isCandidate: false, targetDiff: 3 });
  });

  it('リストが空なら0件', () => {
    const list = listOf(() => {});
    expect(list.groups).toEqual([]);
    expect(list.progress).toEqual({ total: 0, purchased: 0, remaining: 0 });
  });
});

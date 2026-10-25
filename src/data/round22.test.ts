// 第22回: 商品にJANコードを保存できるようにした分の確認。
//
// ここで確かめたいこと
//   ・JANコードを入れても、入れなくても、これまでどおり登録・編集・削除できる
//   ・JANコードが無い古いデータ・古いバックアップをそのまま読める
//   ・バックアップ／復元とクラウド同期でJANコードが行き来する
//   ・クラウド側にJANの列が無いうちは、JANコードを外して送れる

import { beforeEach, describe, expect, it } from 'vitest';
import { fingerprint, fromRows, toRows, withoutJan } from '../cloud/cloudRows';
import { productsWithSameJan } from '../lib/search';
import { validateProductForm, type ProductForm, type ProductInput } from '../lib/validation';
import { createSampleData } from './mockData';
import { createRepository, STORAGE_KEY, type StorageLike } from './repository';
import { loadAppData, parseAppData } from './schema';
import type { AppData } from './types';

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
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

const stored = (s: MemoryStorage): AppData => JSON.parse(s.getItem(STORAGE_KEY)!);

const input = (over: Partial<ProductInput> = {}): ProductInput => ({
  category: '飲料',
  name: '天然水',
  unitAmount: 1,
  unit: 'L',
  targetUnitPrice: 50,
  ...over,
});

const form = (over: Partial<ProductForm> = {}): ProductForm => ({
  category: '飲料',
  name: '天然水',
  unitAmount: '1',
  unit: 'L',
  targetUnitPrice: '',
  maker: '',
  memo: '',
  jan: '',
  ...over,
});

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

describe('JANコードの保存', () => {
  it('JANコードを付けて登録でき、保存データにも残る', () => {
    const repo = createRepository(storage);
    const result = repo.addProduct(input({ jan: '4902102072618' }));
    expect(result.ok).toBe(true);
    expect(stored(storage).products.at(-1)).toMatchObject({ name: '天然水', jan: '4902102072618' });
  });

  it('JANコードを入れなくても、これまでどおり登録できる（項目自体を持たない）', () => {
    const repo = createRepository(storage);
    const result = repo.addProduct(input());
    expect(result.ok && result.value.jan).toBeUndefined();
    expect(Object.keys(stored(storage).products.at(-1)!)).not.toContain('jan');
  });

  it('あとからJANコードを足したり、消したりできる', () => {
    const repo = createRepository(storage);
    const added = repo.addProduct(input());
    const id = added.ok ? added.value.id : '';

    repo.updateProduct(id, input({ jan: '4902102072618' }));
    expect(stored(storage).products.find((p) => p.id === id)?.jan).toBe('4902102072618');

    // 空欄にして更新すると消える（ほかの項目は残る）
    repo.updateProduct(id, input({ jan: undefined, memo: '残る' }));
    const after = stored(storage).products.find((p) => p.id === id)!;
    expect(after.jan).toBeUndefined();
    expect(after.memo).toBe('残る');
  });

  it('正しくないJANコードは保存されない', () => {
    const repo = createRepository(storage);
    const result = repo.addProduct(input({ jan: '12345' }));
    expect(result.ok).toBe(false);
    expect(stored(storage).products.some((p) => p.name === '天然水')).toBe(false);
  });

  it('JANコードを付けた商品も、これまでどおり削除できる', () => {
    const repo = createRepository(storage);
    const added = repo.addProduct(input({ jan: '4902102072618' }));
    const id = added.ok ? added.value.id : '';
    expect(repo.deleteProduct(id).ok).toBe(true);
    expect(stored(storage).products.some((p) => p.id === id)).toBe(false);
  });
});

describe('同じJANコードの商品を知らせる', () => {
  const products = [
    { id: 'P001', jan: '4902102072618' },
    { id: 'P002', jan: '4902102072618' },
    { id: 'P003' },
  ];

  it('同じコードの商品を見つける（自分自身は除く）', () => {
    expect(productsWithSameJan(products, '4902102072618').map((p) => p.id)).toEqual(['P001', 'P002']);
    expect(productsWithSameJan(products, '4902102072618', 'P001').map((p) => p.id)).toEqual(['P002']);
  });

  it('JANコードが無いときは何も出さない', () => {
    expect(productsWithSameJan(products, undefined)).toEqual([]);
    expect(productsWithSameJan(products, '')).toEqual([]);
  });

  it('登録を妨げるものではない（入力の検査では問題にしない）', () => {
    expect(validateProductForm(form({ jan: '4902102072618' })).errors).toEqual({});
  });
});

describe('古いデータとの行き来', () => {
  it('JANコードが無い古いバックアップをそのまま読める', () => {
    const repo = createRepository(storage);
    const backup = repo.createBackup();
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    const json = JSON.parse(backup.value.json) as { products: Record<string, unknown>[] };
    // 第21回までのバックアップには jan が無い
    expect(json.products.every((p) => !('jan' in p))).toBe(true);
    expect(parseAppData(backup.value.json).ok).toBe(true);
  });

  it('JANコードを含むバックアップを復元すると、JANコードも戻る', () => {
    const repo = createRepository(storage);
    repo.addProduct(input({ jan: '4902102072618' }));
    const backup = repo.createBackup();
    const json = backup.ok ? backup.value.json : '';

    const other = createRepository(new MemoryStorage());
    const parsed = parseAppData(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(other.restore(parsed.data).ok).toBe(true);
    expect(other.getSnapshot().data?.products.at(-1)?.jan).toBe('4902102072618');
  });

  it('JANコードの形が文字列でないデータは読み込まない', () => {
    const broken = { version: 1, products: [{ id: 'P001', category: 'a', name: 'b', unitAmount: 1, unit: 'L', targetUnitPrice: null, jan: 4902102072618 }], stores: [], priceRecords: [], shoppingList: [], purchased: [], counters: { product: 1, store: 0, record: 0 } };
    expect(loadAppData(broken).ok).toBe(false);
  });
});

describe('クラウド同期', () => {
  const USER = '11111111-1111-1111-1111-111111111111';

  function dataWithJan(): AppData {
    const base = createSampleData();
    return { ...base, products: base.products.map((p, i) => (i === 0 ? { ...p, jan: '4902102072618' } : p)) };
  }

  it('クラウドへ送って戻してもJANコードが保たれる', () => {
    const rows = toRows(USER, dataWithJan());
    expect(rows.products[0].jan).toBe('4902102072618');
    expect(rows.products[1].jan).toBeNull();

    const loaded = loadAppData(
      fromRows({ products: rows.products, stores: rows.stores, priceRecords: rows.priceRecords, shoppingItems: rows.shoppingItems, settings: rows.settings }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.products[0].jan).toBe('4902102072618');
    expect(loaded.data.products[1].jan).toBeUndefined();
  });

  it('JANコードの違いは「内容が同じか」の照合でも見つかる', () => {
    const withJan = dataWithJan();
    const withOther = { ...withJan, products: withJan.products.map((p, i) => (i === 0 ? { ...p, jan: '49012347' } : p)) };
    expect(fingerprint(withJan)).not.toBe(fingerprint(withOther));
  });

  it('クラウド側に列が無いときは、JANコードを外した行を作れる（ほかの項目は残る）', () => {
    const rows = toRows(USER, dataWithJan());
    const safe = withoutJan(rows.products);
    expect(safe.every((r) => !('jan' in r))).toBe(true);
    expect(safe[0].name).toBe(rows.products[0].name);
    expect(safe).toHaveLength(rows.products.length);
  });
});

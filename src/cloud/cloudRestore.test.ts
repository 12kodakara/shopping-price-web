import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleData } from '../data/mockData';
import { createRepository, STORAGE_KEY, UNDO_KEY, type StorageLike } from '../data/repository';
import { loadAppData, parseAppData } from '../data/schema';
import type { AppData } from '../data/types';
import { countsOf, fromRows, toRows } from './cloudRows';

// 第13回: クラウド → この端末 の取り込み（復元）を、データの流れに沿って確認する。
//   クラウドの行 → fromRows → loadAppData（= getCloudData の後半）→ repository.restore → localStorage
// 本番で不具合を確認した「買い物リストだけが違う」状態を再現する。

const USER = '11111111-1111-1111-1111-111111111111';

/** localStorage の代わり。特定のキーへの書き込みだけ失敗させられる */
class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  failKeys = new Set<string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    if (this.failKeys.has(key)) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

/** この端末：商品5 / 店舗9 / 価格履歴10 / 買い物リスト0（サンプルデータそのもの） */
const localData = (): AppData => createSampleData();

/** クラウド：商品5 / 店舗9 / 価格履歴10 / 買い物リスト4（うち1件は購入済み） */
function cloudData(): AppData {
  const data = createSampleData();
  data.shoppingList = ['P001', 'P003', 'P004', 'P005'];
  data.purchased = ['P004'];
  return data;
}

/** クラウドから取得したのと同じ手順で、取り込むデータを作る（getCloudData の後半と同じ） */
function fetchedFromCloud(data: AppData): AppData {
  const rows = toRows(USER, data);
  const loaded = loadAppData(
    fromRows({
      products: rows.products,
      stores: rows.stores,
      priceRecords: rows.priceRecords,
      shoppingItems: rows.shoppingItems,
      settings: rows.settings,
    }),
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.data;
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(localData()));
});

const stored = (): AppData => JSON.parse(storage.getItem(STORAGE_KEY)!);

describe('クラウド → この端末（買い物リストだけが違う状態から）', () => {
  it('★取得したデータに買い物リスト4件が含まれている', () => {
    const fetched = fetchedFromCloud(cloudData());
    expect(countsOf(fetched)).toMatchObject({ products: 5, stores: 9, priceRecords: 10, shoppingList: 4, purchased: 1 });
  });

  it('★取り込むと、この端末が 商品5 / 店舗9 / 価格履歴10 / 買い物リスト4 になる', () => {
    const repo = createRepository(storage);
    expect(countsOf(repo.getSnapshot().data!)).toMatchObject({ products: 5, stores: 9, priceRecords: 10, shoppingList: 0 });

    const result = repo.restore(fetchedFromCloud(cloudData()));
    expect(result.ok).toBe(true);

    // localStorage（この端末の正本）
    expect(countsOf(stored())).toMatchObject({ products: 5, stores: 9, priceRecords: 10, shoppingList: 4, purchased: 1 });
    expect(stored().shoppingList).toEqual(['P001', 'P003', 'P004', 'P005']);
    expect(stored().purchased).toEqual(['P004']);
    // 画面が使うデータ（React はこのスナップショットの変化で再描画する）
    expect(countsOf(repo.getSnapshot().data!)).toMatchObject({ shoppingList: 4, purchased: 1 });
  });

  it('取り込むと、画面へ変更が通知される（再描画される）', () => {
    const repo = createRepository(storage);
    let notified = 0;
    repo.subscribe(() => notified++);
    const before = repo.getSnapshot();
    repo.restore(fetchedFromCloud(cloudData()));
    expect(notified).toBeGreaterThan(0);
    // useSyncExternalStore は参照が変わったときだけ再描画するので、別のオブジェクトになっていること
    expect(repo.getSnapshot()).not.toBe(before);
  });

  it('★取り込む前のこの端末のデータを「復元前バックアップ」として退避し、元に戻せる', () => {
    const before = storage.getItem(STORAGE_KEY);
    const repo = createRepository(storage);
    repo.restore(fetchedFromCloud(cloudData()));

    const slot = JSON.parse(storage.getItem(UNDO_KEY)!);
    expect(slot.raw).toBe(before);
    expect(slot.reason).toBe('restore');
    expect(repo.getSnapshot().undo?.summary.shoppingList).toBe(0);

    expect(repo.undoReplace().ok).toBe(true);
    expect(stored()).toEqual(JSON.parse(before!));
    expect(stored().shoppingList).toEqual([]);
  });

  it('★退避できないときは取り込まず、この端末のデータを変えない', () => {
    const before = storage.getItem(STORAGE_KEY);
    const repo = createRepository(storage);
    storage.failKeys.add(UNDO_KEY);

    const result = repo.restore(fetchedFromCloud(cloudData()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('退避できなかった');
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(repo.getSnapshot().data!.shoppingList).toEqual([]);
  });

  it('★書き込みに失敗したときは、中途半端な状態を残さない（元のデータのまま）', () => {
    const before = storage.getItem(STORAGE_KEY);
    const repo = createRepository(storage);
    storage.failKeys.add(STORAGE_KEY);

    const result = repo.restore(fetchedFromCloud(cloudData()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('現在のデータはそのまま');
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    // 画面のデータも変わらない
    expect(repo.getSnapshot().data!.shoppingList).toEqual([]);
  });

  it('取り込んだデータは既存の形式（version 1）のまま、そのまま読み直せる', () => {
    const repo = createRepository(storage);
    repo.restore(fetchedFromCloud(cloudData()));

    const raw = storage.getItem(STORAGE_KEY)!;
    expect(JSON.parse(raw).version).toBe(1);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['counters', 'priceRecords', 'products', 'purchased', 'shoppingList', 'stores', 'version']);
    const reread = parseAppData(raw);
    expect(reread.ok).toBe(true);
    // 別のタブ・再読み込みでも同じ内容になる
    const again = createRepository(storage);
    expect(countsOf(again.getSnapshot().data!)).toMatchObject({ products: 5, stores: 9, priceRecords: 10, shoppingList: 4 });
  });

  it('JSONバックアップ（version 1）として書き出して、また復元できる', () => {
    const repo = createRepository(storage);
    repo.restore(fetchedFromCloud(cloudData()));
    const backup = repo.createBackup();
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    const preview = repo.previewRestore(backup.value.json);
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.value.summary.shoppingList).toBe(4);
  });
});

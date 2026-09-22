import { beforeEach, describe, expect, it } from 'vitest';
import { buildCompareRows, buildHistory, buildShoppingCandidates, compareTargets, recordUnitPrice } from '../lib/price';
import { createSampleData } from './mockData';
import { BACKUP_KEY_PREFIX, createRepository, STORAGE_KEY, UNDO_KEY, type StorageLike } from './repository';
import { parseAppData } from './schema';
import type { AppData } from './types';

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  failWrites = false;
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
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const now = () => new Date('2026-09-22T10:30:00+09:00');
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

const stored = (): AppData => JSON.parse(storage.getItem(STORAGE_KEY)!);
const snapshotData = (repo: ReturnType<typeof createRepository>) => repo.getSnapshot().data!;

function compareRow(data: AppData, productId: string) {
  const t = compareTargets(data);
  return buildCompareRows(t.products, t.records).find((r) => r.product.id === productId);
}

describe('バックアップの作成', () => {
  it('JSONに version と全データが含まれ、ファイル名に日付が入る', () => {
    const repo = createRepository(storage, now);
    repo.setShoppingSelected('P005', true);
    const b = repo.createBackup();
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.value.filename).toBe('shopping-price-backup-2026-09-22.json');
    const json = JSON.parse(b.value.json);
    expect(json).toMatchObject({ app: 'shopping-price-web', version: 1, exportedAt: '2026-09-22T01:30:00.000Z' });
    expect(Object.keys(json).sort()).toEqual(['app', 'counters', 'exportedAt', 'priceRecords', 'products', 'purchased', 'shoppingList', 'stores', 'version']);
    expect(json.products).toHaveLength(5);
    expect(json.stores).toHaveLength(9);
    expect(json.priceRecords).toHaveLength(10);
    expect(json.shoppingList).toEqual(['P005']);
    expect(json.counters).toEqual({ product: 5, store: 9, record: 10 });
    expect(b.value.summary).toMatchObject({ products: 5, stores: 9, priceRecords: 10, shoppingList: 1 });
  });

  it('バックアップの中身は、そのまま保存データとして読み込める', () => {
    const repo = createRepository(storage, now);
    const b = repo.createBackup();
    if (!b.ok) throw new Error();
    const parsed = parseAppData(b.value.json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toEqual(stored());
  });
});

describe('復元', () => {
  function backupOf(mutate?: (d: AppData) => void): string {
    const d = createSampleData();
    mutate?.(d);
    return JSON.stringify({ app: 'shopping-price-web', exportedAt: '2026-09-01T00:00:00Z', ...d });
  }

  it('確認前（previewRestore）は保存データを変更しない', () => {
    const repo = createRepository(storage, now);
    repo.addStore({ name: '業務スーパー' });
    const before = storage.getItem(STORAGE_KEY);
    const p = repo.previewRestore(backupOf());
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.value.summary).toMatchObject({ products: 5, stores: 9, priceRecords: 10, shoppingList: 0 });
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('正常に復元でき、復元前のデータは1段階だけ戻せる', () => {
    const repo = createRepository(storage, now);
    repo.addStore({ name: '業務スーパー' });
    const before = storage.getItem(STORAGE_KEY);
    const p = repo.previewRestore(backupOf((d) => d.stores.splice(7, 1)));
    if (!p.ok) throw new Error(p.error);

    expect(repo.restore(p.value.data).ok).toBe(true);
    expect(stored().stores).toHaveLength(8);
    expect(snapshotData(repo).stores).toHaveLength(8);
    expect(JSON.parse(storage.getItem(UNDO_KEY)!).raw).toBe(before);
    expect(repo.getSnapshot().undo).toMatchObject({ reason: 'restore', summary: { stores: 10 } });

    expect(repo.undoReplace().ok).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(snapshotData(repo).stores).toHaveLength(10);
    expect(repo.getSnapshot().undo).toBeNull();
    expect(repo.undoReplace().ok).toBe(false); // 1段階だけ
  });

  it('バックアップ以外の余分な項目（app・exportedAt）は保存データに含めない', () => {
    const repo = createRepository(storage, now);
    const p = repo.previewRestore(backupOf());
    if (!p.ok) throw new Error();
    repo.restore(p.value.data);
    expect(Object.keys(stored()).sort()).toEqual(['counters', 'priceRecords', 'products', 'purchased', 'shoppingList', 'stores', 'version']);
  });

  const invalid: [string, string][] = [
    ['JSONとして壊れている', '{"version":1,"products":['],
    ['空のファイル', ''],
    ['配列', '[]'],
    ['version がない', backupOf((d) => delete (d as Partial<AppData>).version)],
    ['対応していない（新しい）version', backupOf((d) => ((d as { version: number }).version = 2))],
    ['対応していない（0）version', backupOf((d) => ((d as { version: number }).version = 0))],
    ['version が文字列', backupOf((d) => ((d as { version: unknown }).version = '1'))],
    ['別アプリのファイル', JSON.stringify({ ...createSampleData(), app: 'other-app' })],
    ['商品データがない', backupOf((d) => delete (d as Partial<AppData>).products)],
    ['価格履歴がない', backupOf((d) => delete (d as Partial<AppData>).priceRecords)],
    ['counters がない', backupOf((d) => delete (d as Partial<AppData>).counters)],
    ['商品IDの形式が不正', backupOf((d) => (d.products[0].id = 'サランラップ'))],
    ['商品IDが重複', backupOf((d) => (d.products[1].id = 'P001'))],
    ['商品名が空', backupOf((d) => (d.products[0].name = ''))],
    ['店舗IDが不正', backupOf((d) => (d.stores[0].id = '1'))],
    ['販売価格がマイナス', backupOf((d) => (d.priceRecords[0].price = -100))],
    ['販売価格が0', backupOf((d) => (d.priceRecords[0].price = 0))],
    ['販売価格が文字列', backupOf((d) => ((d.priceRecords[0] as { price: unknown }).price = '840'))],
    ['販売数量が0', backupOf((d) => (d.priceRecords[0].quantity = 0))],
    ['存在しない日付', backupOf((d) => (d.priceRecords[0].date = '2026-02-30'))],
    ['存在しない商品を指す価格記録', backupOf((d) => (d.priceRecords[0].productId = 'P999'))],
    ['存在しない店舗を指す価格記録', backupOf((d) => (d.priceRecords[0].storeId = 'S999'))],
    ['登録順の番号が重複', backupOf((d) => (d.priceRecords[1].seq = d.priceRecords[0].seq))],
    ['買い物リストに存在しない商品', backupOf((d) => (d.shoppingList = ['P999']))],
  ];

  for (const [label, text] of invalid) {
    it(`不正なバックアップは拒否し、既存データを変更しない：${label}`, () => {
      const repo = createRepository(storage, now);
      repo.addStore({ name: '業務スーパー' });
      const before = storage.getItem(STORAGE_KEY);
      const p = repo.previewRestore(text);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.error.length).toBeGreaterThan(0);
      expect(storage.getItem(STORAGE_KEY)).toBe(before);
      expect(storage.getItem(UNDO_KEY)).toBeNull();
      expect(snapshotData(repo).stores).toHaveLength(10);
    });
  }

  it('復元（restore）にも不正なデータを直接渡せない', () => {
    const repo = createRepository(storage, now);
    const before = storage.getItem(STORAGE_KEY);
    const bad = createSampleData();
    bad.priceRecords[0].price = -1;
    expect(repo.restore(bad).ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('退避に失敗したら復元を中止し、既存データを変更しない', () => {
    const repo = createRepository(storage, now);
    const before = storage.getItem(STORAGE_KEY);
    const p = repo.previewRestore(backupOf((d) => d.stores.splice(7, 1)));
    if (!p.ok) throw new Error();
    storage.failWrites = true;
    expect(repo.restore(p.value.data).ok).toBe(false);
    storage.failWrites = false;
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(snapshotData(repo).stores).toHaveLength(9);
  });

  it('壊れた保存データの状態からでも復元でき、壊れたデータは別に残す', () => {
    storage.setItem(STORAGE_KEY, '{壊れた');
    const repo = createRepository(storage, now);
    expect(repo.getSnapshot().status.kind).toBe('corrupt');
    const p = repo.previewRestore(backupOf());
    if (!p.ok) throw new Error();
    expect(repo.restore(p.value.data).ok).toBe(true);
    expect(repo.getSnapshot().status.kind).toBe('ready');
    const backupKey = [...storage.map.keys()].find((k) => k.startsWith(BACKUP_KEY_PREFIX))!;
    expect(storage.getItem(backupKey)).toBe('{壊れた');
  });

  it('サンプルデータに戻した後も、1つ前の状態に戻せる', () => {
    const repo = createRepository(storage, now);
    repo.addStore({ name: '業務スーパー' });
    repo.resetToSample();
    expect(stored().stores).toHaveLength(9);
    expect(repo.getSnapshot().undo?.reason).toBe('reset');
    repo.undoReplace();
    expect(stored().stores).toHaveLength(10);
  });

  it('保存量のおおよその値を返す', () => {
    const repo = createRepository(storage, now);
    const usage = repo.storageUsage()!;
    expect(usage).toBeGreaterThan(storage.getItem(STORAGE_KEY)!.length);
  });
});

describe('商品・店舗の編集', () => {
  it('商品の全項目を編集でき、IDと価格履歴は変わらない', () => {
    const repo = createRepository(storage, now);
    const r = repo.updateProduct('P005', {
      category: 'お茶',
      name: '麦茶 2L',
      unitAmount: 2,
      unit: 'L',
      targetUnitPrice: 75,
      maker: 'サントリー食品',
      memo: '6本入り',
    });
    expect(r).toMatchObject({ ok: true, value: { id: 'P005', name: '麦茶 2L', unitAmount: 2, unit: 'L' } });
    const data = stored();
    const p = data.products.find((x) => x.id === 'P005')!;
    expect(buildHistory(p, data.priceRecords).count).toBe(4);
    // 基準数量を 2 に変えると「2単位あたり」で再計算される（6 で 840円 → 1あたり140円 → 2あたり280円）
    expect(compareRow(data, 'P005')?.cheapest?.unitPrice).toBe(280);
  });

  it('使用停止の状態は、編集しても保たれる', () => {
    const repo = createRepository(storage, now);
    repo.setProductArchived('P002', true);
    const p = stored().products.find((x) => x.id === 'P002')!;
    repo.updateProduct('P002', { ...p, name: 'クレラップ（旧）' });
    expect(stored().products.find((x) => x.id === 'P002')).toMatchObject({ name: 'クレラップ（旧）', archived: true });
  });

  it('店舗名を変更しても、店舗IDで価格履歴・最安店が維持される', () => {
    const repo = createRepository(storage, now);
    repo.updateStore('S009', { name: 'MrMax 本店', type: 'ディスカウント', memo: '駐車場あり' });
    const data = stored();
    expect(data.stores.find((s) => s.id === 'S009')).toMatchObject({ name: 'MrMax 本店', memo: '駐車場あり' });
    expect(compareRow(data, 'P005')?.cheapest?.storeId).toBe('S009');
    expect(data.priceRecords.filter((r) => r.storeId === 'S009')).toHaveLength(2);
  });
});

describe('価格記録の編集', () => {
  it('価格を直すと、単価・最安・目安との差・買い物候補・履歴が再計算される', () => {
    const repo = createRepository(storage, now);
    // やさしい麦茶 ミスターマックス 6本 840円（R010）を 6本 1020円 に修正 → 170円/本 で目安160円超え
    const original = stored().priceRecords.find((r) => r.id === 'R010')!;
    const r = repo.updatePriceRecord('R010', { ...original, price: 1020, sale: false });
    expect(r).toMatchObject({ ok: true, value: { id: 'R010', price: 1020, seq: original.seq, createdAt: original.createdAt } });
    if (r.ok) expect(r.value.updatedAt).toBeDefined();

    const data = stored();
    const tea = data.products.find((p) => p.id === 'P005')!;
    expect(recordUnitPrice(data.priceRecords.find((x) => x.id === 'R010')!, tea)).toBe(170);
    const row = compareRow(data, 'P005')!;
    expect(row.cheapest).toMatchObject({ storeId: 'S003', unitPrice: 158 });
    expect(row.targetDiff).toBe(-2);
    const t = compareTargets(data);
    const candidates = buildShoppingCandidates(buildCompareRows(t.products, t.records));
    expect(candidates.map((c) => c.product.id)).toEqual(['P002', 'P004', 'P005', 'P003']);
    const h = buildHistory(tea, data.priceRecords);
    expect(h.current?.unitPrice).toBe(170);
    expect(h.lowest?.unitPrice).toBe(150);
  });

  it('日付を古く直すと、最新価格が入れ替わる', () => {
    const repo = createRepository(storage, now);
    const r010 = stored().priceRecords.find((r) => r.id === 'R010')!;
    repo.updatePriceRecord('R010', { ...r010, date: '2026-08-01', sale: false });
    const data = stored();
    const h = buildHistory(data.products[4], data.priceRecords);
    expect(h.current?.record.id).toBe('R005'); // 9/15 のドン・キホーテが最新に
    expect(compareRow(data, 'P005')?.storePrices.find((s) => s.storeId === 'S009')?.unitPrice).toBe(150); // 8/30 の記録が最新
  });

  it('商品を付け替えると、履歴が移動する', () => {
    const repo = createRepository(storage, now);
    const r007 = stored().priceRecords.find((r) => r.id === 'R007')!; // クレラップ
    repo.updatePriceRecord('R007', { ...r007, productId: 'P001', sale: false });
    const data = stored();
    expect(buildHistory(data.products[0], data.priceRecords).count).toBe(3);
    expect(buildHistory(data.products[1], data.priceRecords).count).toBe(0);
  });

  it('不正な修正は保存しない', () => {
    const repo = createRepository(storage, now);
    const before = storage.getItem(STORAGE_KEY);
    const r010 = stored().priceRecords.find((r) => r.id === 'R010')!;
    const base = { ...r010, sale: false };
    expect(repo.updatePriceRecord('R010', { ...base, price: 0 }).ok).toBe(false);
    expect(repo.updatePriceRecord('R010', { ...base, quantity: -1 }).ok).toBe(false);
    expect(repo.updatePriceRecord('R010', { ...base, date: '' }).ok).toBe(false);
    expect(repo.updatePriceRecord('R010', { ...base, productId: 'P999' }).ok).toBe(false);
    expect(repo.updatePriceRecord('R999', base).ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('価格記録を削除でき、削除したIDは再利用しない', () => {
    const repo = createRepository(storage, now);
    expect(repo.deletePriceRecord('R010').ok).toBe(true);
    const data = stored();
    expect(data.priceRecords.map((r) => r.id)).not.toContain('R010');
    expect(compareRow(data, 'P005')?.cheapest?.unitPrice).toBe(150); // 8/30 のミスターマックス 150円
    const tea = data.products[4];
    const r = repo.addPriceRecord({ date: '2026-09-23', productId: 'P005', storeId: 'S009', quantity: 6, price: 840, sale: false });
    expect(r).toMatchObject({ ok: true, value: { id: 'R011' } });
    expect(buildHistory(tea, stored().priceRecords).count).toBe(4);
    expect(repo.deletePriceRecord('R010').ok).toBe(false); // もうない
  });
});

describe('商品・店舗の使用停止と削除', () => {
  it('価格履歴がある商品は削除できない（データは変わらない）', () => {
    const repo = createRepository(storage, now);
    const before = storage.getItem(STORAGE_KEY);
    const r = repo.deleteProduct('P005');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('使用停止');
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(repo.deleteStore('S009').ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('価格履歴がない商品・店舗は削除でき、IDは再利用しない', () => {
    const repo = createRepository(storage, now);
    repo.addProduct({ category: '日用品', name: '試しに登録', unitAmount: 1, unit: '個', targetUnitPrice: null });
    repo.setShoppingSelected('P006', true);
    expect(repo.deleteProduct('P006').ok).toBe(true);
    expect(stored().shoppingList).not.toContain('P006');
    expect(repo.addProduct({ category: '日用品', name: '次', unitAmount: 1, unit: '個', targetUnitPrice: null })).toMatchObject({ value: { id: 'P007' } });
    expect(repo.deleteStore('S005').ok).toBe(true); // ドラッグストアは記録0件
  });

  it('使用停止の商品は比較・買い物候補から外れ、履歴は残る。再開すると戻る', () => {
    const repo = createRepository(storage, now);
    repo.setProductArchived('P005', true);
    let data = stored();
    expect(compareRow(data, 'P005')).toBeUndefined();
    const t = compareTargets(data);
    expect(buildShoppingCandidates(buildCompareRows(t.products, t.records)).map((c) => c.product.id)).not.toContain('P005');
    expect(buildHistory(data.products[4], data.priceRecords).count).toBe(4);

    repo.setProductArchived('P005', false);
    data = stored();
    expect(data.products[4].archived).toBeUndefined();
    expect(compareRow(data, 'P005')?.cheapest?.unitPrice).toBe(140);
  });

  it('使用停止の店舗の価格は最安にしない（履歴には残る）', () => {
    const repo = createRepository(storage, now);
    repo.setStoreArchived('S009', true);
    const data = stored();
    expect(compareRow(data, 'P005')?.cheapest).toMatchObject({ storeId: 'S003', unitPrice: 158 });
    expect(buildHistory(data.products[4], data.priceRecords).lowest?.unitPrice).toBe(140);
  });

  it('使用停止の情報はバックアップ・復元でも保たれる', () => {
    const repo = createRepository(storage, now);
    repo.setProductArchived('P002', true);
    repo.setStoreArchived('S008', true);
    const b = repo.createBackup();
    if (!b.ok) throw new Error();
    repo.resetToSample();
    const p = repo.previewRestore(b.value.json);
    if (!p.ok) throw new Error(p.error);
    expect(p.value.summary).toMatchObject({ archivedProducts: 1, archivedStores: 1 });
    repo.restore(p.value.data);
    expect(stored().products.find((x) => x.id === 'P002')?.archived).toBe(true);
    expect(stored().stores.find((x) => x.id === 'S008')?.archived).toBe(true);
  });
});

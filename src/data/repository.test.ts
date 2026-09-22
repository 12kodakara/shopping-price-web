import { beforeEach, describe, expect, it } from 'vitest';
import { buildCompareRows, buildHistory, buildShoppingCandidates } from '../lib/price';
import type { PriceInput, ProductInput } from '../lib/validation';
import { createSampleData } from './mockData';
import { BACKUP_KEY_PREFIX, createRepository, nextId, STORAGE_KEY, type StorageLike } from './repository';
import type { AppData } from './types';

/** localStorage の代わり（Map で保持） */
class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  failWrites = false;
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

/** 時計を手動で進められるようにする（二重登録防止の時間判定用） */
function clock(start = '2026-09-22T10:00:00Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

const stored = (s: MemoryStorage): AppData => JSON.parse(s.getItem(STORAGE_KEY)!);

const teaInput = (over: Partial<PriceInput> = {}): PriceInput => ({
  date: '2026-09-23',
  productId: 'P005',
  storeId: 'S002',
  quantity: 6,
  price: 780,
  sale: false,
  ...over,
});

const newProduct: ProductInput = { category: '飲料', name: '天然水', unitAmount: 1, unit: 'L', targetUnitPrice: 50, maker: 'サントリー' };

let storage: MemoryStorage;
let c: ReturnType<typeof clock>;
beforeEach(() => {
  storage = new MemoryStorage();
  c = clock();
});

describe('初回データ', () => {
  it('保存データがなければサンプルデータを投入して保存する', () => {
    const repo = createRepository(storage, c.now);
    expect(repo.getSnapshot().status).toEqual({ kind: 'ready', seeded: true });
    const data = stored(storage);
    expect(data.products.map((p) => p.id)).toEqual(['P001', 'P002', 'P003', 'P004', 'P005']);
    expect(data.stores).toHaveLength(9);
    expect(data.priceRecords).toHaveLength(10);
  });

  it('保存データがあれば上書きしない', () => {
    const custom = createSampleData();
    custom.products[0].name = '自分で変更した名前';
    storage.setItem(STORAGE_KEY, JSON.stringify(custom));
    const repo = createRepository(storage, c.now);
    expect(repo.getSnapshot().status).toEqual({ kind: 'ready', seeded: false });
    expect(repo.getSnapshot().data!.products[0].name).toBe('自分で変更した名前');
    expect(stored(storage).products[0].name).toBe('自分で変更した名前');
  });
});

describe('保存と復元', () => {
  it('保存した内容は、作り直した repository（＝再読み込み）でも残っている', () => {
    const repo = createRepository(storage, c.now);
    repo.addProduct(newProduct);
    repo.addStore({ name: '業務スーパー' });
    repo.addPriceRecord(teaInput());
    repo.setShoppingSelected('P005', true);

    const reloaded = createRepository(storage, c.now).getSnapshot().data!;
    expect(reloaded.products.at(-1)).toMatchObject({ id: 'P006', name: '天然水' });
    expect(reloaded.stores.at(-1)).toMatchObject({ id: 'S010', name: '業務スーパー' });
    expect(reloaded.priceRecords.at(-1)).toMatchObject({ productId: 'P005', storeId: 'S002', price: 780 });
    expect(reloaded.shoppingList).toEqual(['P005']);
  });

  it('保存に失敗したら画面上のデータも変更しない', () => {
    const repo = createRepository(storage, c.now);
    storage.failWrites = true;
    const r = repo.addStore({ name: '失敗する店' });
    expect(r.ok).toBe(false);
    expect(repo.getSnapshot().data!.stores).toHaveLength(9);
  });

  it('別タブで保存された変更を上書きしない（最新を読み直してから保存する）', () => {
    const tab1 = createRepository(storage, c.now);
    const tab2 = createRepository(storage, c.now);
    tab1.addStore({ name: 'タブ1の店' });
    tab2.addStore({ name: 'タブ2の店' });
    const names = stored(storage).stores.map((s) => s.name);
    expect(names).toContain('タブ1の店');
    expect(names).toContain('タブ2の店');
    expect(stored(storage).stores.map((s) => s.id).slice(-2)).toEqual(['S010', 'S011']);
  });
});

describe('ID自動発番', () => {
  it('P001〜P005 の次は P006、その次は P007', () => {
    const repo = createRepository(storage, c.now);
    expect(repo.addProduct(newProduct)).toMatchObject({ ok: true, value: { id: 'P006' } });
    expect(repo.addProduct({ ...newProduct, name: '別の水' })).toMatchObject({ ok: true, value: { id: 'P007' } });
  });

  it('削除されたIDは再利用しない（通し番号を保持している）', () => {
    const data = createSampleData();
    // P005 が削除された状態（価格記録が残っている商品は削除できないため、記録もない状態にする）
    data.products = data.products.filter((p) => p.id !== 'P005');
    data.priceRecords = data.priceRecords.filter((r) => r.productId !== 'P005');
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    const repo = createRepository(storage, c.now);
    expect(repo.addProduct(newProduct)).toMatchObject({ ok: true, value: { id: 'P006' } });
  });

  it('通し番号より大きいIDが既にあっても重複しない', () => {
    expect(nextId('P', 5, ['P001', 'P009'])).toEqual({ id: 'P010', counter: 10 });
    expect(nextId('S', 9, ['S001'])).toEqual({ id: 'S010', counter: 10 });
    expect(nextId('P', 999, [])).toEqual({ id: 'P1000', counter: 1000 });
  });

  it('店舗は S010 から', () => {
    const repo = createRepository(storage, c.now);
    expect(repo.addStore({ name: '業務スーパー' })).toMatchObject({ ok: true, value: { id: 'S010', name: '業務スーパー' } });
  });
});

describe('価格登録', () => {
  it('登録した記録に ID・登録順・登録日時が付く', () => {
    const repo = createRepository(storage, c.now);
    const r = repo.addPriceRecord(teaInput({ sale: true, note: 'チラシ' }));
    expect(r).toMatchObject({
      ok: true,
      value: { id: 'R011', seq: 11, createdAt: '2026-09-22T10:00:00.000Z', sale: true, note: 'チラシ', quantity: 6, price: 780 },
    });
  });

  it('同じ内容を続けて登録しても1件しか保存しない（二重クリック対策）', () => {
    const repo = createRepository(storage, c.now);
    expect(repo.addPriceRecord(teaInput()).ok).toBe(true);
    c.advance(200);
    expect(repo.addPriceRecord(teaInput()).ok).toBe(false);
    expect(stored(storage).priceRecords).toHaveLength(11);
  });

  it('時間を空ければ同じ内容でも登録できる（別の日に同じ値段だった等）', () => {
    const repo = createRepository(storage, c.now);
    repo.addPriceRecord(teaInput());
    c.advance(10_000);
    expect(repo.addPriceRecord(teaInput()).ok).toBe(true);
  });

  it('不正な入力は保存しない', () => {
    const repo = createRepository(storage, c.now);
    const bad: PriceInput[] = [
      teaInput({ productId: '' }),
      teaInput({ storeId: '' }),
      teaInput({ date: '' }),
      teaInput({ date: '2026-02-30' }),
      teaInput({ quantity: 0 }),
      teaInput({ quantity: -1 }),
      teaInput({ quantity: Number.NaN }),
      teaInput({ price: 0 }),
      teaInput({ price: Number.NaN }),
      teaInput({ productId: 'P999' }),
      teaInput({ storeId: 'S999' }),
    ];
    for (const input of bad) expect(repo.addPriceRecord(input).ok, JSON.stringify(input)).toBe(false);
    expect(stored(storage).priceRecords).toHaveLength(10);
  });
});

describe('登録内容が各計算に反映される', () => {
  it('より安い価格を登録すると最安店・最安単価・買い物候補・履歴が変わる', () => {
    const repo = createRepository(storage, c.now);
    // サランラップは目安430円に対し最安433円 → 候補外
    let data = repo.getSnapshot().data!;
    expect(buildShoppingCandidates(buildCompareRows(data.products, data.priceRecords)).map((r) => r.product.id)).not.toContain('P001');

    repo.addPriceRecord({ date: '2026-09-23', productId: 'P001', storeId: 'S003', quantity: 1, price: 398, sale: false });
    data = repo.getSnapshot().data!;
    const row = buildCompareRows(data.products, data.priceRecords).find((r) => r.product.id === 'P001')!;
    expect(row.cheapest).toMatchObject({ storeId: 'S003', unitPrice: 398 });
    expect(row.targetDiff).toBe(-32);
    const candidates = buildShoppingCandidates(buildCompareRows(data.products, data.priceRecords)).map((r) => r.product.id);
    expect(candidates[0]).toBe('P001'); // 差が一番大きいので先頭

    const h = buildHistory(data.products[0], data.priceRecords);
    expect(h.current?.unitPrice).toBe(398);
    expect(h.previous?.unitPrice).toBe(433);
    expect(h.changeFromPrevious).toBe(-35);
    expect(h.count).toBe(3);
  });

  it('同じ店で値上がりした場合は、その店の最新価格（新しい日付）で比較する', () => {
    const repo = createRepository(storage, c.now);
    // ミスターマックスの麦茶 140円 → 9/23 に 170円へ
    repo.addPriceRecord({ date: '2026-09-23', productId: 'P005', storeId: 'S009', quantity: 6, price: 1020, sale: false });
    const data = repo.getSnapshot().data!;
    const row = buildCompareRows(data.products, data.priceRecords).find((r) => r.product.id === 'P005')!;
    expect(row.storePrices.find((s) => s.storeId === 'S009')?.unitPrice).toBe(170);
    expect(row.cheapest).toMatchObject({ storeId: 'S003', unitPrice: 158 }); // 次に安いドンキ
    expect(row.pastLowest).toBe(140);
  });

  it('古い日付の記録を後から登録しても「最新」にはならない', () => {
    const repo = createRepository(storage, c.now);
    repo.addPriceRecord({ date: '2026-09-01', productId: 'P005', storeId: 'S009', quantity: 6, price: 600, sale: false });
    const data = repo.getSnapshot().data!;
    const row = buildCompareRows(data.products, data.priceRecords).find((r) => r.product.id === 'P005')!;
    expect(row.storePrices.find((s) => s.storeId === 'S009')?.unitPrice).toBe(140); // 9/22 の記録が最新のまま
    expect(buildHistory(data.products[4], data.priceRecords).current?.unitPrice).toBe(140);
    expect(row.pastLowest).toBe(100); // 過去最安には含まれる
  });

  it('同じ日付・同じ店の記録が複数あれば、後から登録した方を最新とする', () => {
    const repo = createRepository(storage, c.now);
    repo.addPriceRecord({ date: '2026-09-22', productId: 'P005', storeId: 'S009', quantity: 6, price: 960, sale: false });
    const data = repo.getSnapshot().data!;
    const row = buildCompareRows(data.products, data.priceRecords).find((r) => r.product.id === 'P005')!;
    expect(row.storePrices.find((s) => s.storeId === 'S009')?.unitPrice).toBe(160);
  });

  it('商品名を変更しても、商品IDで価格履歴が維持される', () => {
    const repo = createRepository(storage, c.now);
    const before = repo.getSnapshot().data!;
    const tea = before.products.find((p) => p.id === 'P005')!;
    const r = repo.updateProduct('P005', { ...tea, name: 'やさしい麦茶 2L' });
    expect(r.ok).toBe(true);

    const data = createRepository(storage, c.now).getSnapshot().data!;
    const renamed = data.products.find((p) => p.id === 'P005')!;
    expect(renamed.name).toBe('やさしい麦茶 2L');
    expect(buildHistory(renamed, data.priceRecords).count).toBe(4);
    expect(buildCompareRows(data.products, data.priceRecords).find((x) => x.product.id === 'P005')?.cheapest?.unitPrice).toBe(140);
  });

  it('店舗名を変更しても、店舗IDで価格履歴が維持される', () => {
    const repo = createRepository(storage, c.now);
    repo.updateStore('S009', { name: 'MrMax', type: 'ディスカウント' });
    const data = repo.getSnapshot().data!;
    expect(data.priceRecords.filter((r) => r.storeId === 'S009')).toHaveLength(2);
    expect(data.stores.find((s) => s.id === 'S009')?.name).toBe('MrMax');
  });
});

describe('商品・店舗の入力チェック', () => {
  it('不正な商品は保存しない', () => {
    const repo = createRepository(storage, c.now);
    const bad: ProductInput[] = [
      { ...newProduct, category: '' },
      { ...newProduct, name: '  ' },
      { ...newProduct, unitAmount: 0 },
      { ...newProduct, unitAmount: Number.NaN },
      { ...newProduct, unit: '' },
      { ...newProduct, targetUnitPrice: -1 },
      { ...newProduct, targetUnitPrice: Number.NaN },
    ];
    for (const input of bad) expect(repo.addProduct(input).ok, JSON.stringify(input)).toBe(false);
    expect(stored(storage).products).toHaveLength(5);
    expect(stored(storage).counters.product).toBe(5); // 失敗時に番号を消費しない
  });

  it('目安単価は空欄（null）や0でもよい', () => {
    const repo = createRepository(storage, c.now);
    expect(repo.addProduct({ ...newProduct, targetUnitPrice: null }).ok).toBe(true);
    expect(repo.addProduct({ ...newProduct, name: '無料サンプル', targetUnitPrice: 0 }).ok).toBe(true);
  });

  it('店舗名が空なら保存しない', () => {
    const repo = createRepository(storage, c.now);
    expect(repo.addStore({ name: '' }).ok).toBe(false);
    expect(repo.addStore({ name: '   ' }).ok).toBe(false);
    expect(stored(storage).stores).toHaveLength(9);
  });
});

describe('データ破損対策', () => {
  const broken = ['{壊れたJSON', 'null', '[]', '{"version":99}', JSON.stringify({ ...createSampleData(), products: [{ id: 'P001' }] })];

  for (const raw of broken) {
    it(`壊れたデータ（${raw.slice(0, 30)}）でも例外にならず、データを消さない`, () => {
      storage.setItem(STORAGE_KEY, raw);
      const repo = createRepository(storage, c.now);
      expect(repo.getSnapshot().status.kind).toBe('corrupt');
      expect(repo.getSnapshot().data).toBeNull();
      expect(repo.addStore({ name: '店' }).ok).toBe(false); // 壊れたデータの上に保存しない
      expect(storage.getItem(STORAGE_KEY)).toBe(raw); // 元のデータはそのまま
    });
  }

  it('IDの重複も壊れたデータとして扱う', () => {
    const data = createSampleData();
    data.stores.push({ ...data.stores[0] });
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    expect(createRepository(storage, c.now).getSnapshot().status.kind).toBe('corrupt');
  });

  it('サンプルデータに戻すと、壊れたデータを退避してから置き換える', () => {
    storage.setItem(STORAGE_KEY, '{壊れたJSON');
    const repo = createRepository(storage, c.now);
    const r = repo.resetToSample();
    expect(r.ok).toBe(true);
    expect(repo.getSnapshot().status.kind).toBe('ready');
    expect(stored(storage).products).toHaveLength(5);
    const backupKey = [...storage.map.keys()].find((k) => k.startsWith(BACKUP_KEY_PREFIX))!;
    expect(storage.getItem(backupKey)).toBe('{壊れたJSON');
  });

  it('localStorage が使えない環境でも動く（保存はされない）', () => {
    const repo = createRepository(null, c.now);
    expect(repo.getSnapshot().status.kind).toBe('memory-only');
    expect(repo.addStore({ name: '一時的な店' }).ok).toBe(true);
    expect(repo.getSnapshot().data!.stores).toHaveLength(10);
  });

  it('読み込み時に例外を投げるストレージでもクラッシュしない', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {},
    };
    expect(createRepository(throwing, c.now).getSnapshot().status.kind).toBe('memory-only');
  });
});

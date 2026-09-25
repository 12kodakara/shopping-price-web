import { describe, expect, it } from 'vitest';
import { createSampleData } from '../data/mockData';
import { loadAppData } from '../data/schema';
import type { AppData } from '../data/types';
import { countsOf, fingerprint, fromRows, isEmptyCounts, toRows } from './cloudRows';

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

/** サンプルに、省略可能な項目（メーカー・使用停止・備考・修正日時）と買い物リストを足したデータ */
function richData(): AppData {
  const data = createSampleData();
  data.products[0] = { ...data.products[0], maker: 'テスト社', memo: 'よく買う', archived: true };
  data.stores[0] = { ...data.stores[0], type: 'スーパー', memo: '駅前' };
  data.priceRecords[0] = { ...data.priceRecords[0], sale: true, note: '特売', updatedAt: '2026-09-23T00:00:00.000Z' };
  data.shoppingList = [data.products[1].id, data.products[2].id];
  data.purchased = [data.products[2].id];
  return data;
}

/** クラウドから返ってくる形（user_id を含む行）に変換する */
function roundTrip(data: AppData, userId = USER): AppData {
  const rows = toRows(userId, data);
  const json = fromRows({
    products: rows.products,
    stores: rows.stores,
    priceRecords: rows.priceRecords,
    shoppingItems: rows.shoppingItems,
    settings: rows.settings,
  });
  const loaded = loadAppData(json);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.data;
}

describe('端末のデータ → クラウドの行', () => {
  it('すべての行に user_id が入り、端末のIDはそのまま使われる', () => {
    const rows = toRows(USER, richData());
    const users = new Set([
      ...rows.products.map((r) => r.user_id),
      ...rows.stores.map((r) => r.user_id),
      ...rows.priceRecords.map((r) => r.user_id),
      ...rows.shoppingItems.map((r) => r.user_id),
      rows.settings.user_id,
    ]);
    expect([...users]).toEqual([USER]);
    expect(rows.products[0].id).toBe('P001');
    expect(rows.stores[0].id).toBe('S001');
    expect(rows.priceRecords[0].id).toBe('R001');
  });

  it('利用者が違えば、同じIDでも別の行になる（衝突しない）', () => {
    const mine = toRows(USER, createSampleData());
    const theirs = toRows(OTHER, createSampleData());
    expect(mine.products[0].id).toBe(theirs.products[0].id);
    expect(mine.products[0].user_id).not.toBe(theirs.products[0].user_id);
  });

  it('省略できる項目は null、使用停止・セールは真偽値になる', () => {
    const rows = toRows(USER, richData());
    expect(rows.products[0]).toMatchObject({ maker: 'テスト社', memo: 'よく買う', archived: true });
    // P004 はメーカー・備考が未設定のサンプル
    expect(rows.products[3]).toMatchObject({ maker: null, archived: false });
    expect(rows.priceRecords[0]).toMatchObject({ sale: true, note: '特売', record_updated_at: '2026-09-23T00:00:00.000Z' });
    expect(rows.priceRecords[1]).toMatchObject({ sale: false, note: null, record_updated_at: null });
  });

  it('買い物リストと購入済みが1つの表になる', () => {
    const data = richData();
    const rows = toRows(USER, data);
    expect(rows.shoppingItems).toEqual([
      { user_id: USER, product_id: data.products[1].id, purchased: false },
      { user_id: USER, product_id: data.products[2].id, purchased: true },
    ]);
  });

  it('ID発番の通し番号も保存される', () => {
    const rows = toRows(USER, createSampleData());
    expect(rows.settings).toMatchObject({ data_version: 1, counter_product: 5, counter_store: 9, counter_record: 10 });
  });
});

describe('クラウドの行 → 端末のデータ', () => {
  it('往復しても内容が変わらない', () => {
    const data = richData();
    expect(roundTrip(data)).toEqual(data);
  });

  it('サンプルデータでも往復で変わらない', () => {
    const data = createSampleData();
    expect(roundTrip(data)).toEqual(data);
  });

  it('日時は端末と同じ形（末尾Z）にそろえられる', () => {
    const data = createSampleData();
    const rows = toRows(USER, data);
    const json = fromRows({
      products: rows.products,
      stores: rows.stores,
      // Supabase は +00:00 形式で返すことがある
      priceRecords: rows.priceRecords.map((r) => ({ ...r, recorded_at: '2026-09-20T12:00:00+00:00' })),
      shoppingItems: rows.shoppingItems,
      settings: rows.settings,
    }) as { priceRecords: { createdAt: string }[] };
    expect(json.priceRecords[0].createdAt).toBe('2026-09-20T12:00:00.000Z');
  });

  it('数値が文字列で返ってきても数値として読み込める', () => {
    const data = createSampleData();
    const rows = toRows(USER, data);
    const json = fromRows({
      products: rows.products.map((r) => ({ ...r, unit_amount: String(r.unit_amount) as unknown as number })),
      stores: rows.stores,
      priceRecords: rows.priceRecords.map((r) => ({ ...r, price: String(r.price) as unknown as number })),
      shoppingItems: rows.shoppingItems,
      settings: rows.settings,
    });
    const loaded = loadAppData(json);
    expect(loaded.ok).toBe(true);
  });

  it('設定の行が無くても、IDから発番番号を作り直す', () => {
    const data = createSampleData();
    const rows = toRows(USER, data);
    const json = fromRows({
      products: rows.products,
      stores: rows.stores,
      priceRecords: rows.priceRecords,
      shoppingItems: rows.shoppingItems,
      settings: null,
    }) as { counters: { product: number; store: number; record: number } };
    expect(json.counters).toEqual({ product: 5, store: 9, record: 10 });
  });

  it('価格記録は登録順（seq）に並ぶ', () => {
    const data = createSampleData();
    const rows = toRows(USER, data);
    const json = fromRows({
      products: rows.products,
      stores: rows.stores,
      priceRecords: [...rows.priceRecords].reverse(),
      shoppingItems: rows.shoppingItems,
      settings: rows.settings,
    }) as { priceRecords: { seq: number }[] };
    expect(json.priceRecords.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('件数と内容の比較', () => {
  it('件数を数えられる', () => {
    const data = richData();
    expect(countsOf(data)).toEqual({ products: 5, stores: 9, priceRecords: 10, shoppingList: 2, purchased: 1 });
  });

  it('空かどうかを判定できる', () => {
    expect(isEmptyCounts({ products: 0, stores: 0, priceRecords: 0, shoppingList: 0, purchased: 0 })).toBe(true);
    expect(isEmptyCounts({ products: 0, stores: 0, priceRecords: 0, shoppingList: 1, purchased: 0 })).toBe(false);
    expect(isEmptyCounts({ products: 1, stores: 0, priceRecords: 0, shoppingList: 0, purchased: 0 })).toBe(false);
  });

  it('同じ内容なら同じ指紋になる（未設定の書き方の違いは無視する）', () => {
    const a = createSampleData();
    const b = createSampleData();
    // P004 はもともとメーカーが未設定。undefined を明示しても、false を明示しても同じ扱いになる
    b.products[3] = { ...b.products[3], maker: undefined, archived: false };
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('並び順が違うだけなら同じ指紋になる', () => {
    const a = createSampleData();
    const b = createSampleData();
    b.products.reverse();
    b.priceRecords.reverse();
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('1件でも値が違えば別の指紋になる', () => {
    const a = createSampleData();
    const b = createSampleData();
    b.priceRecords[0] = { ...b.priceRecords[0], price: b.priceRecords[0].price + 1 };
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('往復したデータは指紋が変わらない', () => {
    const data = richData();
    expect(fingerprint(roundTrip(data))).toBe(fingerprint(data));
  });
});

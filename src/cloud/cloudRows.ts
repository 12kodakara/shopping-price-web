// 端末のデータ（AppData）と、クラウド（Supabase）の表の行との相互変換。
//
// ここは通信をしない純粋な変換だけ。テストしやすいように分けている。
// 端末側のID（P001 / S001 / R001）はそのままクラウドでも使う。主キーが (user_id, id) なので、
// 別の利用者と同じIDがあっても衝突しない。

import type { AppData, PriceRecord, Product, Store } from '../data/types';

export interface ProductRow {
  user_id: string;
  id: string;
  category: string;
  name: string;
  unit_amount: number;
  unit: string;
  target_unit_price: number | null;
  maker: string | null;
  memo: string | null;
  archived: boolean;
}

export interface StoreRow {
  user_id: string;
  id: string;
  name: string;
  type: string | null;
  memo: string | null;
  archived: boolean;
}

export interface PriceRecordRow {
  user_id: string;
  id: string;
  date: string;
  product_id: string;
  store_id: string;
  quantity: number;
  price: number;
  sale: boolean;
  note: string | null;
  seq: number;
  recorded_at: string;
  record_updated_at: string | null;
}

export interface ShoppingItemRow {
  user_id: string;
  product_id: string;
  purchased: boolean;
}

export interface UserSettingsRow {
  user_id: string;
  data_version: number;
  counter_product: number;
  counter_store: number;
  counter_record: number;
}

export interface CloudRows {
  products: ProductRow[];
  stores: StoreRow[];
  priceRecords: PriceRecordRow[];
  shoppingItems: ShoppingItemRow[];
  settings: UserSettingsRow;
}

/** 件数の概要（同期前の確認に使う） */
export interface DataCounts {
  products: number;
  stores: number;
  priceRecords: number;
  shoppingList: number;
  purchased: number;
}

export const EMPTY_COUNTS: DataCounts = { products: 0, stores: 0, priceRecords: 0, shoppingList: 0, purchased: 0 };

export function countsOf(data: AppData): DataCounts {
  return {
    products: data.products.length,
    stores: data.stores.length,
    priceRecords: data.priceRecords.length,
    shoppingList: data.shoppingList.length,
    purchased: data.purchased.length,
  };
}

/** データが1件も無いか */
export function isEmptyCounts(counts: DataCounts): boolean {
  return counts.products === 0 && counts.stores === 0 && counts.priceRecords === 0 && counts.shoppingList === 0;
}

const orNull = (v: string | undefined): string | null => (v === undefined || v === '' ? null : v);
const orUndef = (v: string | null | undefined): string | undefined => (v === null || v === undefined || v === '' ? undefined : v);
/** 文字列で返ってくることがある数値を確実に数値にする */
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
/** 日時を端末側と同じ形にそろえる */
const iso = (v: string): string => new Date(v).toISOString();

// ---------- 端末 → クラウド ----------

export function toRows(userId: string, data: AppData): CloudRows {
  return {
    products: data.products.map((p) => ({
      user_id: userId,
      id: p.id,
      category: p.category,
      name: p.name,
      unit_amount: p.unitAmount,
      unit: p.unit,
      target_unit_price: p.targetUnitPrice,
      maker: orNull(p.maker),
      memo: orNull(p.memo),
      archived: p.archived === true,
    })),
    stores: data.stores.map((s) => ({
      user_id: userId,
      id: s.id,
      name: s.name,
      type: orNull(s.type),
      memo: orNull(s.memo),
      archived: s.archived === true,
    })),
    priceRecords: data.priceRecords.map((r) => ({
      user_id: userId,
      id: r.id,
      date: r.date,
      product_id: r.productId,
      store_id: r.storeId,
      quantity: r.quantity,
      price: r.price,
      sale: r.sale === true,
      note: orNull(r.note),
      seq: r.seq,
      recorded_at: r.createdAt,
      record_updated_at: r.updatedAt ?? null,
    })),
    shoppingItems: data.shoppingList.map((productId) => ({
      user_id: userId,
      product_id: productId,
      purchased: data.purchased.includes(productId),
    })),
    settings: {
      user_id: userId,
      data_version: data.version,
      counter_product: data.counters.product,
      counter_store: data.counters.store,
      counter_record: data.counters.record,
    },
  };
}

// ---------- クラウド → 端末 ----------

/**
 * 取得した行から、保存データと同じ形のJSON値を組み立てる。
 * ここでは検証しない（呼び出し側で loadAppData に通して確認する）。
 */
export function fromRows(rows: {
  products: ProductRow[];
  stores: StoreRow[];
  priceRecords: PriceRecordRow[];
  shoppingItems: ShoppingItemRow[];
  settings: UserSettingsRow | null;
}): unknown {
  const products: Product[] = rows.products.map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    unitAmount: num(r.unit_amount),
    unit: r.unit,
    targetUnitPrice: r.target_unit_price === null || r.target_unit_price === undefined ? null : num(r.target_unit_price),
    ...(orUndef(r.maker) === undefined ? {} : { maker: orUndef(r.maker) }),
    ...(orUndef(r.memo) === undefined ? {} : { memo: orUndef(r.memo) }),
    ...(r.archived ? { archived: true } : {}),
  }));

  const stores: Store[] = rows.stores.map((r) => ({
    id: r.id,
    name: r.name,
    ...(orUndef(r.type) === undefined ? {} : { type: orUndef(r.type) }),
    ...(orUndef(r.memo) === undefined ? {} : { memo: orUndef(r.memo) }),
    ...(r.archived ? { archived: true } : {}),
  }));

  const priceRecords: PriceRecord[] = rows.priceRecords.map((r) => ({
    id: r.id,
    date: r.date,
    productId: r.product_id,
    storeId: r.store_id,
    quantity: num(r.quantity),
    price: num(r.price),
    ...(r.sale ? { sale: true } : {}),
    ...(orUndef(r.note) === undefined ? {} : { note: orUndef(r.note) }),
    seq: num(r.seq),
    createdAt: iso(r.recorded_at),
    ...(r.record_updated_at ? { updatedAt: iso(r.record_updated_at) } : {}),
  }));

  // 登録順（seq）で並べ直す。画面側の「最新」の判定は seq を見るが、見た目の並びもそろえる
  priceRecords.sort((a, b) => a.seq - b.seq);

  const shoppingList = rows.shoppingItems.map((r) => r.product_id);
  const purchased = rows.shoppingItems.filter((r) => r.purchased).map((r) => r.product_id);

  // 発番番号が無い・小さすぎる場合は、実データから作り直す（IDの重複を避けるため）
  const maxNum = (ids: string[]) => ids.reduce((max, id) => Math.max(max, Number(id.slice(1)) || 0), 0);
  const counters = {
    product: Math.max(rows.settings?.counter_product ?? 0, maxNum(products.map((p) => p.id))),
    store: Math.max(rows.settings?.counter_store ?? 0, maxNum(stores.map((s) => s.id))),
    record: Math.max(rows.settings?.counter_record ?? 0, maxNum(priceRecords.map((r) => r.id))),
  };

  return {
    version: rows.settings?.data_version ?? 1,
    products,
    stores,
    priceRecords,
    shoppingList,
    purchased,
    counters,
  };
}

// ---------- 内容の比較 ----------

/**
 * 内容が同じかどうかを比べるための文字列。
 * 未設定の項目（undefined・空文字・false）の書き方の違いは無視してそろえる。
 */
export function fingerprint(data: AppData): string {
  const sep = '\u0001';
  const products = data.products
    .map((x) =>
      [x.id, x.category, x.name, x.unitAmount, x.unit, x.targetUnitPrice ?? '', x.maker ?? '', x.memo ?? '', x.archived === true].join(sep),
    )
    .sort();
  const stores = data.stores.map((x) => [x.id, x.name, x.type ?? '', x.memo ?? '', x.archived === true].join(sep)).sort();
  const records = data.priceRecords
    .map((x) =>
      [x.id, x.date, x.productId, x.storeId, x.quantity, x.price, x.sale === true, x.note ?? '', x.seq, x.createdAt, x.updatedAt ?? ''].join(sep),
    )
    .sort();
  return JSON.stringify([products, stores, records, [...data.shoppingList].sort(), [...data.purchased].sort()]);
}

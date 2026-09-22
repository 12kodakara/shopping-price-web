import type { PriceRecord, Product, ProductId, Store, StoreId } from '../data/types';

// 価格計算ロジック（Excel版の考え方を踏襲した簡易版）。
// 画面から切り離しておき、単体テストで確認できるようにしている。

/** 比較単位あたりの単価。数量・価格が不正なら null */
export function calcUnitPrice(price: number, quantity: number, unitAmount = 1): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || price < 0 || quantity <= 0) return null;
  return roundPrice((price / quantity) * unitAmount);
}

/** 浮動小数の誤差（199.8 - 200 = -0.19999… など）を避けるため小数第2位で丸める */
export function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 目安との差（マイナスなら目安より安い） */
export function calcDiff(unitPrice: number | null, target: number | null): number | null {
  if (unitPrice === null || target === null) return null;
  return roundPrice(unitPrice - target);
}

/**
 * 古い順に並べる比較関数。
 * 「最新」は配列の並び順ではなく日付で判断し、同じ日付なら登録順（seq）が後の方を新しいとみなす。
 * seq は重複しない通し番号なので、同日の記録が複数あっても順序は常に一定になる。
 */
export function compareRecordsOldestFirst(a: PriceRecord, b: PriceRecord): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.seq - b.seq;
}

export function recordUnitPrice(record: PriceRecord, product: Product): number | null {
  return calcUnitPrice(record.price, record.quantity, product.unitAmount);
}

export interface StorePrice {
  storeId: StoreId;
  unitPrice: number;
  record: PriceRecord;
}

export interface CompareRow {
  product: Product;
  /** 店舗ごとの最新単価 */
  storePrices: StorePrice[];
  cheapest: StorePrice | null;
  targetDiff: number | null;
  pastLowest: number | null;
}

/**
 * 価格比較・買い物候補の対象。
 * 使用停止の商品は比較せず、使用停止の店舗の価格は最安の候補にしない（価格履歴には残る）。
 */
export function compareTargets(data: { products: Product[]; stores: Store[]; priceRecords: PriceRecord[] }): {
  products: Product[];
  records: PriceRecord[];
} {
  const stopped = new Set(data.stores.filter((s) => s.archived).map((s) => s.id));
  return {
    products: data.products.filter((p) => !p.archived),
    records: data.priceRecords.filter((r) => !stopped.has(r.storeId)),
  };
}

/** 価格比較: 各店舗の最新価格のうち最も安いものを最安とする */
export function buildCompareRows(products: Product[], records: PriceRecord[]): CompareRow[] {
  // 記録を商品ごとに1回だけ振り分ける（商品ごとに全記録を調べると、商品数×記録数の処理になるため）
  const byProduct = new Map<ProductId, PriceRecord[]>();
  for (const r of records) {
    const list = byProduct.get(r.productId);
    if (list) list.push(r);
    else byProduct.set(r.productId, [r]);
  }

  return products.map((product) => {
    const latestByStore = new Map<StoreId, PriceRecord>();
    const own = (byProduct.get(product.id) ?? []).sort(compareRecordsOldestFirst);
    for (const r of own) latestByStore.set(r.storeId, r); // 日付順なので最後が最新

    const storePrices: StorePrice[] = [];
    for (const record of latestByStore.values()) {
      const unitPrice = recordUnitPrice(record, product);
      if (unitPrice !== null) storePrices.push({ storeId: record.storeId, unitPrice, record });
    }
    storePrices.sort((a, b) => a.unitPrice - b.unitPrice);

    const cheapest = storePrices[0] ?? null;
    let pastLowest: number | null = null;
    for (const r of own) {
      const u = recordUnitPrice(r, product);
      if (u !== null && (pastLowest === null || u < pastLowest)) pastLowest = u;
    }
    return {
      product,
      storePrices,
      cheapest,
      targetDiff: calcDiff(cheapest?.unitPrice ?? null, product.targetUnitPrice),
      pastLowest,
    };
  });
}

/** 買い物候補: 最安単価が目安単価以下の商品を、目安との差が大きい（お得な）順に */
export function buildShoppingCandidates(rows: CompareRow[]): CompareRow[] {
  return rows
    .filter((r) => r.targetDiff !== null && r.targetDiff <= 0)
    .sort((a, b) => (a.targetDiff as number) - (b.targetDiff as number));
}

export interface HistoryPoint {
  record: PriceRecord;
  unitPrice: number;
}

export interface HistorySummary {
  points: HistoryPoint[];
  current: HistoryPoint | null;
  previous: HistoryPoint | null;
  lowest: HistoryPoint | null;
  highest: HistoryPoint | null;
  /** 前回比（現在 − 前回。マイナスなら値下がり） */
  changeFromPrevious: number | null;
  /** 過去最安との差（現在 − 過去最安。0なら現在が過去最安） */
  diffFromLowest: number | null;
  count: number;
}

/** 価格履歴: 現在＝最も新しい記録、前回＝その1つ前。最安・最高が同額なら先に記録した方 */
export function buildHistory(product: Product, records: PriceRecord[]): HistorySummary {
  const points = records
    .filter((r) => r.productId === product.id)
    .sort(compareRecordsOldestFirst)
    .map((record) => ({ record, unitPrice: recordUnitPrice(record, product) }))
    .filter((p): p is HistoryPoint => p.unitPrice !== null);

  let lowest: HistoryPoint | null = null;
  let highest: HistoryPoint | null = null;
  for (const p of points) {
    if (!lowest || p.unitPrice < lowest.unitPrice) lowest = p;
    if (!highest || p.unitPrice > highest.unitPrice) highest = p;
  }
  const current = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  return {
    points,
    current,
    previous,
    lowest,
    highest,
    changeFromPrevious: current && previous ? roundPrice(current.unitPrice - previous.unitPrice) : null,
    diffFromLowest: current && lowest ? roundPrice(current.unitPrice - lowest.unitPrice) : null,
    count: points.length,
  };
}

/** 新しく登録した順（登録順の通し番号の降順） */
export function recentlyRegistered(records: PriceRecord[], limit: number): PriceRecord[] {
  return [...records].sort((a, b) => b.seq - a.seq).slice(0, limit);
}

export function storeName(stores: Store[], id: StoreId): string {
  return stores.find((s) => s.id === id)?.name ?? '（不明な店舗）';
}

export function productName(products: Product[], id: ProductId): string {
  return products.find((p) => p.id === id)?.name ?? '（不明な商品）';
}

const yenFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });

/** 例: 424.5 → "424.5"、1698 → "1,698" */
export function formatYen(value: number): string {
  return yenFormat.format(value);
}

/** 例: 2026-09-22 → "9/22" */
export function formatShortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

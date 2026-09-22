import type { PriceRecord, Product, ProductId, Store, StoreId } from '../data/types';

// 検索・絞り込みの判定（画面から切り離して単体テストできるようにしている）。
// 検索条件は画面の一時的な状態として扱い、保存データには含めない。

/**
 * 比較用に文字を整える。
 *   ・前後の空白を無視
 *   ・全角英数字 → 半角、半角カナ → 全角（NFKC）
 *   ・英字の大文字・小文字を区別しない
 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim();
}

/** 検索語を空白（全角空白を含む）で区切る。空欄なら [] */
export function searchTerms(query: string): string[] {
  const q = normalizeText(query);
  return q === '' ? [] : q.split(/\s+/);
}

/**
 * 部分一致の判定。空白で区切った語はすべて含む必要がある（AND）。
 * 各語は、どれか1つの項目に含まれていればよい。検索語が空なら常に一致。
 */
export function matchesQuery(query: string, fields: (string | undefined)[]): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const haystack = fields.filter((f): f is string => !!f).map(normalizeText);
  return terms.every((t) => haystack.some((h) => h.includes(t)));
}

// ---------- 使用中 / 使用停止 ----------

export type StatusFilter = 'active' | 'archived' | 'all';

export const STATUS_LABELS: Record<StatusFilter, string> = { active: '使用中', archived: '使用停止', all: 'すべて' };

export function matchesStatus(item: { archived?: boolean }, status: StatusFilter): boolean {
  if (status === 'all') return true;
  return status === 'archived' ? Boolean(item.archived) : !item.archived;
}

/** 商品の検索対象: 品目・カテゴリ・メーカー・メモ・商品ID */
export function productMatches(p: Product, query: string): boolean {
  return matchesQuery(query, [p.name, p.category, p.maker, p.memo, p.id]);
}

/** 店舗の検索対象: 店舗名・種類・メモ・店舗ID */
export function storeMatches(s: Store, query: string): boolean {
  return matchesQuery(query, [s.name, s.type, s.memo, s.id]);
}

// ---------- 価格履歴 ----------

export interface RecordFilter {
  query: string;
  /** YYYY-MM-DD。空欄なら指定なし */
  from: string;
  to: string;
}

export const EMPTY_RECORD_FILTER: RecordFilter = { query: '', from: '', to: '' };

/**
 * 期間を整える。開始日 > 終了日 の場合は入れ替えて扱い、そのことを画面で知らせられるよう swapped を返す。
 */
export function normalizePeriod(from: string, to: string): { from: string; to: string; swapped: boolean } {
  if (from && to && from > to) return { from: to, to: from, swapped: true };
  return { from, to, swapped: false };
}

/**
 * 価格記録の絞り込み。検索語は商品名・店舗名に部分一致、期間は開始日・終了日を含む。
 * 名前は商品ID・店舗IDから引くので、商品名・店舗名を変更しても新しい名前で検索できる。
 */
export function filterRecords(
  records: PriceRecord[],
  filter: RecordFilter,
  names: { product: (id: ProductId) => string | undefined; store: (id: StoreId) => string | undefined },
): PriceRecord[] {
  const { from, to } = normalizePeriod(filter.from, filter.to);
  const terms = searchTerms(filter.query);

  // 商品名・店舗名の正規化は、記録ごとではなく名前ごとに1回だけ行う
  const cache = new Map<string, string>();
  const normalized = (key: string, name: () => string | undefined) => {
    let v = cache.get(key);
    if (v === undefined) {
      v = normalizeText(name() ?? '');
      cache.set(key, v);
    }
    return v;
  };

  return records.filter((r) => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (terms.length === 0) return true;
    const p = normalized(`p:${r.productId}`, () => names.product(r.productId));
    const s = normalized(`s:${r.storeId}`, () => names.store(r.storeId));
    return terms.every((t) => p.includes(t) || s.includes(t));
  });
}

export function isRecordFilterActive(f: RecordFilter): boolean {
  return f.query.trim() !== '' || f.from !== '' || f.to !== '';
}

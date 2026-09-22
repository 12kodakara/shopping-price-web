// 一覧のページ分割（商品・店舗・価格履歴）。
// 処理の順番は必ず「全データ → 検索・絞り込み → 並べ替え → ページ分割 → 表示」。
// ページ分割は最後に行い、検索は常に全データを対象にする。

/** 1ページの件数。スマホで1ページをスクロールしきれる長さで、かつ前後の移動が多すぎない件数 */
export const PAGE_SIZE = 50;

export interface PageResult<T> {
  /** このページに表示するもの */
  items: T[];
  /** 実際に表示するページ（1から。存在しないページを求められたら範囲内に補正した値） */
  page: number;
  pageCount: number;
  /** 表示している範囲（1から数えた番号）。0件なら 0〜0 */
  start: number;
  end: number;
  total: number;
}

/**
 * 指定したページを取り出す。存在しないページ（削除や絞り込みで件数が減った場合など）は、
 * 1ページ目〜最後のページの範囲に補正するので、空のページは表示されない。
 */
export function paginate<T>(items: T[], requestedPage: number, pageSize = PAGE_SIZE): PageResult<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const wanted = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.min(Math.max(1, wanted), pageCount);
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  return {
    items: pageItems,
    page,
    pageCount,
    start: total === 0 ? 0 : startIndex + 1,
    end: startIndex + pageItems.length,
    total,
  };
}

/** 何番目（0から）の項目が何ページ目にあるか */
export function pageOfIndex(index: number, pageSize = PAGE_SIZE): number {
  return Math.floor(Math.max(0, index) / pageSize) + 1;
}

/**
 * 件数の表示。
 *   絞り込みなし: 「58件」／複数ページなら「全128件中 51〜100件」
 *   絞り込みあり: 「12 / 58件」／複数ページなら「120 / 500件（51〜100件目）」
 */
export function formatCount(p: { shown: number; total: number; filtered: boolean; start: number; end: number; pageCount: number }): string {
  if (!p.filtered) return p.pageCount > 1 ? `全${p.total}件中 ${p.start}〜${p.end}件` : `${p.total}件`;
  return p.pageCount > 1 ? `${p.shown} / ${p.total}件（${p.start}〜${p.end}件目）` : `${p.shown} / ${p.total}件`;
}

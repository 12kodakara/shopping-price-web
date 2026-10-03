// 一覧表の並び替え（第19回）。
//
// 見出しを押すたびに「昇順 → 降順 → 元の並び」と切り替える。
// 元の並び（並び替えなし）に戻せるようにしているのは、買い物候補の「お得な順」のように
// 画面ごとの初期の並びに意味があるため。
//
// 画面に依存しない処理なので、商品一覧など他の一覧でもそのまま使える。

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  /** 並び替えに使う列。null なら画面ごとの初期の並び */
  key: K | null;
  direction: SortDirection;
}

/** 並び替えなしの状態 */
export function noSort<K extends string>(): SortState<K> {
  return { key: null, direction: 'asc' };
}

/** 見出しを押したときの次の状態（昇順 → 降順 → 元の並び） */
export function nextSortState<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return noSort();
}

/** 画面読み上げ用の aria-sort の値 */
export function ariaSort<K extends string>(state: SortState<K>, key: K): 'ascending' | 'descending' | 'none' {
  if (state.key !== key) return 'none';
  return state.direction === 'asc' ? 'ascending' : 'descending';
}

/** 見出しに付ける矢印（押すと何が起きるか分かるように、今の状態を示す） */
export function sortMark<K extends string>(state: SortState<K>, key: K): string {
  if (state.key !== key) return '';
  return state.direction === 'asc' ? '↑' : '↓';
}

/** 並び替えに使える値。数値は数値のまま比べる（文字列として比べない） */
export type SortValue = string | number | boolean | null | undefined;

/**
 * 並び替える。
 *   ・数値は数値として、文字列は日本語の並び（localeCompare）で比べる
 *   ・値がないもの（null・undefined）は、昇順でも降順でも最後に置く
 *   ・同じ値のときは元の並びを保つ（安定）
 */
export function sortRows<T, K extends string>(
  rows: T[],
  state: SortState<K>,
  values: Record<K, (row: T) => SortValue>,
): T[] {
  if (state.key === null) return rows;
  const get = values[state.key];
  const sign = state.direction === 'asc' ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((a, b) => {
      const empty = (v: SortValue) => v === null || v === undefined || v === '';
      if (empty(a.value) && empty(b.value)) return a.index - b.index;
      if (empty(a.value)) return 1; // 値がないものは常に最後
      if (empty(b.value)) return -1;

      const compared = compare(a.value, b.value);
      return compared !== 0 ? compared * sign : a.index - b.index;
    })
    .map((x) => x.row);
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Number(a === true) - Number(b === true);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  // numeric: true にすると P1 → P2 → P10 の順になる（文字列のままだと P1 → P10 → P2）
  return String(a).localeCompare(String(b), 'ja', { numeric: true });
}

/** 並び替えの対象が、数値／文字／あり・なし のどれか（スマホの表示文言を変えるために使う） */
export type SortKind = 'number' | 'text' | 'flag';

/**
 * スマホの並び替えボタンに出す文言。
 * 金額は「安い順／高い順」、文字は「昇順／降順」、あり・なしは「なしから／ありから」と言い分ける。
 */
export function directionLabel(kind: SortKind, direction: SortDirection): string {
  if (kind === 'number') return direction === 'asc' ? '↑ 安い順' : '↓ 高い順';
  if (kind === 'flag') return direction === 'asc' ? '↑ なしから' : '↓ ありから';
  return direction === 'asc' ? '↑ 昇順' : '↓ 降順';
}

/** 押すと反対の並びになることを読み上げで伝える文言 */
export function directionToggleLabel(kind: SortKind, direction: SortDirection): string {
  const now = directionLabel(kind, direction).replace(/^[↑↓]\s*/, '');
  const next = directionLabel(kind, direction === 'asc' ? 'desc' : 'asc').replace(/^[↑↓]\s*/, '');
  return `いまは${now}。押すと${next}に切り替わります`;
}

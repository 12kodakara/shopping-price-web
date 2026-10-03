import { describe, expect, it } from 'vitest';
import { ariaSort, nextSortState, noSort, sortMark, sortRows, type SortState } from './tableSort';

type Column = 'name' | 'price' | 'flag';

interface Row {
  name: string;
  price: number | null;
  flag: boolean;
}

const rows: Row[] = [
  { name: 'つや姫', price: 596, flag: true },
  { name: 'やさしい麦茶', price: 140, flag: false },
  { name: 'クレラップ', price: null, flag: true },
  { name: 'サランラップ', price: 430, flag: false },
];

const values = {
  name: (r: Row) => r.name,
  price: (r: Row) => r.price,
  flag: (r: Row) => r.flag,
};

const names = (list: Row[]) => list.map((r) => r.name);

describe('見出しを押したときの切り替え', () => {
  it('昇順 → 降順 → 元の並び、の順に変わる', () => {
    let state: SortState<Column> = noSort<Column>();
    state = nextSortState(state, 'price');
    expect(state).toEqual({ key: 'price', direction: 'asc' });
    state = nextSortState(state, 'price');
    expect(state).toEqual({ key: 'price', direction: 'desc' });
    state = nextSortState(state, 'price');
    expect(state.key).toBeNull(); // 元の並びに戻せる（画面ごとの初期の並びに意味があるため）
  });

  it('別の列を押したら、その列の昇順から始まる', () => {
    const state = nextSortState({ key: 'price', direction: 'desc' }, 'name');
    expect(state).toEqual({ key: 'name', direction: 'asc' });
  });

  it('画面読み上げ用の値と矢印を返す', () => {
    const asc: SortState<Column> = { key: 'price', direction: 'asc' };
    expect(ariaSort(asc, 'price')).toBe('ascending');
    expect(ariaSort(asc, 'name')).toBe('none');
    expect(sortMark(asc, 'price')).toBe('↑');
    expect(sortMark({ key: 'price', direction: 'desc' }, 'price')).toBe('↓');
    expect(sortMark(asc, 'name')).toBe('');
  });
});

describe('並び替え', () => {
  it('並び替えなしのときは、元の並びのまま', () => {
    expect(sortRows(rows, noSort<Column>(), values)).toEqual(rows);
  });

  it('★数値は数値として比べる（文字列として並べない）', () => {
    expect(names(sortRows(rows, { key: 'price', direction: 'asc' }, values))).toEqual([
      'やさしい麦茶', // 140
      'サランラップ', // 430
      'つや姫', // 596
      'クレラップ', // 値なしは最後
    ]);
  });

  it('降順でも、値がないものは最後に置く', () => {
    expect(names(sortRows(rows, { key: 'price', direction: 'desc' }, values))).toEqual([
      'つや姫',
      'サランラップ',
      'やさしい麦茶',
      'クレラップ',
    ]);
  });

  it('文字列は日本語の並びで比べる', () => {
    const sorted = names(sortRows(rows, { key: 'name', direction: 'asc' }, values));
    expect(sorted[0]).toBe('クレラップ');
    expect(sorted[sorted.length - 1]).toBe('やさしい麦茶');
    expect(names(sortRows(rows, { key: 'name', direction: 'desc' }, values))[0]).toBe('やさしい麦茶');
  });

  it('真偽値は「いいえ → はい」の順（降順では逆）', () => {
    expect(names(sortRows(rows, { key: 'flag', direction: 'asc' }, values))).toEqual([
      'やさしい麦茶',
      'サランラップ',
      'つや姫',
      'クレラップ',
    ]);
    expect(names(sortRows(rows, { key: 'flag', direction: 'desc' }, values))).toEqual([
      'つや姫',
      'クレラップ',
      'やさしい麦茶',
      'サランラップ',
    ]);
  });

  it('同じ値のときは元の並びを保つ（並びが揺れない）', () => {
    const same: Row[] = [
      { name: 'あ', price: 100, flag: true },
      { name: 'い', price: 100, flag: true },
      { name: 'う', price: 100, flag: true },
    ];
    expect(names(sortRows(same, { key: 'price', direction: 'asc' }, values))).toEqual(['あ', 'い', 'う']);
    expect(names(sortRows(same, { key: 'price', direction: 'desc' }, values))).toEqual(['あ', 'い', 'う']);
  });

  it('元の配列は書き換えない', () => {
    const copy = [...rows];
    sortRows(rows, { key: 'price', direction: 'asc' }, values);
    expect(rows).toEqual(copy);
  });
});

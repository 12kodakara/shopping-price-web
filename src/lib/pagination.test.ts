import { describe, expect, it } from 'vitest';
import { formatCount, pageOfIndex, paginate, PAGE_SIZE } from './pagination';

const list = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('ページ分割', () => {
  it('1ページ50件', () => {
    expect(PAGE_SIZE).toBe(50);
  });

  const cases: [number, number, number, number, number][] = [
    // 件数, 求めたページ, ページ数, 表示の先頭, 表示の末尾
    [0, 1, 1, 0, 0],
    [1, 1, 1, 1, 1],
    [49, 1, 1, 1, 49],
    [50, 1, 1, 1, 50],
    [51, 1, 2, 1, 50],
    [51, 2, 2, 51, 51],
    [100, 2, 2, 51, 100],
    [101, 3, 3, 101, 101],
  ];
  for (const [total, page, pageCount, start, end] of cases) {
    it(`${total}件の${page}ページ目 → 全${pageCount}ページ、${start}〜${end}件`, () => {
      const r = paginate(list(total), page);
      expect(r).toMatchObject({ page, pageCount, start, end, total });
      expect(r.items).toEqual(list(total).slice(start === 0 ? 0 : start - 1, end));
    });
  }

  it('最初・中間・最後のページ', () => {
    const items = list(250);
    expect(paginate(items, 1).items[0]).toBe(1);
    expect(paginate(items, 3)).toMatchObject({ start: 101, end: 150 });
    expect(paginate(items, 5)).toMatchObject({ start: 201, end: 250, pageCount: 5 });
  });

  it('存在しないページは範囲内に補正する（空のページを出さない）', () => {
    expect(paginate(list(101), 8)).toMatchObject({ page: 3, start: 101, end: 101 });
    expect(paginate(list(100), 3)).toMatchObject({ page: 2, start: 51, end: 100 }); // 最終ページの1件を削除した後
    expect(paginate(list(3), 0).page).toBe(1);
    expect(paginate(list(3), -5).page).toBe(1);
    expect(paginate(list(3), Number.NaN).page).toBe(1);
    expect(paginate([], 4)).toMatchObject({ page: 1, pageCount: 1, items: [] });
  });

  it('何番目がどのページにあるか', () => {
    expect(pageOfIndex(0)).toBe(1);
    expect(pageOfIndex(49)).toBe(1);
    expect(pageOfIndex(50)).toBe(2);
    expect(pageOfIndex(100)).toBe(3);
  });
});

describe('件数の表示', () => {
  const base = { start: 1, end: 5, pageCount: 1 };
  it('1ページに収まる場合は従来どおり', () => {
    expect(formatCount({ ...base, shown: 5, total: 5, filtered: false })).toBe('5件');
    expect(formatCount({ ...base, shown: 2, total: 5, filtered: true })).toBe('2 / 5件');
    expect(formatCount({ shown: 0, total: 5, filtered: true, start: 0, end: 0, pageCount: 1 })).toBe('0 / 5件');
  });
  it('複数ページでは表示中の範囲も出す', () => {
    expect(formatCount({ shown: 128, total: 128, filtered: false, start: 51, end: 100, pageCount: 3 })).toBe('全128件中 51〜100件');
    expect(formatCount({ shown: 120, total: 500, filtered: true, start: 1, end: 50, pageCount: 3 })).toBe('120 / 500件（1〜50件目）');
  });
});

import { describe, expect, it } from 'vitest';
import { mockPriceRecords, mockProducts, mockStores } from '../data/mockData';
import type { Product, Store } from '../data/types';
import {
  EMPTY_RECORD_FILTER,
  filterRecords,
  isRecordFilterActive,
  matchesQuery,
  matchesStatus,
  normalizePeriod,
  normalizeText,
  productMatches,
  searchTerms,
  storeMatches,
} from './search';

const names = {
  product: (id: string) => mockProducts.find((p) => p.id === id)?.name,
  store: (id: string) => mockStores.find((s) => s.id === id)?.name,
};
const ids = (records: { id: string }[]) => records.map((r) => r.id);

describe('文字の正規化', () => {
  it('前後の空白（全角空白も）を無視し、英字は小文字にそろえる', () => {
    expect(normalizeText('  Amazon　')).toBe('amazon');
    expect(normalizeText('ＡＭＡＺＯＮ')).toBe('amazon');
    expect(normalizeText('ﾑｼｭｰﾀﾞ')).toBe('ムシューダ');
  });
  it('空白で区切った語に分ける。空欄なら条件なし', () => {
    expect(searchTerms('  麦茶　イオン ')).toEqual(['麦茶', 'イオン']);
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('部分一致', () => {
  it('日本語の部分一致', () => {
    expect(matchesQuery('麦', ['やさしい麦茶'])).toBe(true);
    expect(matchesQuery('ラップ', ['サランラップ'])).toBe(true);
    expect(matchesQuery('牛乳', ['やさしい麦茶'])).toBe(false);
  });
  it('英字の大文字・小文字を区別しない', () => {
    expect(matchesQuery('amazon', ['Amazon'])).toBe(true);
    expect(matchesQuery('AMA', ['Amazon'])).toBe(true);
    expect(matchesQuery('ＡＭＡＺＯＮ', ['Amazon'])).toBe(true);
  });
  it('前後の空白は無視する', () => {
    expect(matchesQuery('  麦茶  ', ['やさしい麦茶'])).toBe(true);
  });
  it('空白で区切った複数の語はすべて含むものだけ（別の項目にあってもよい）', () => {
    expect(matchesQuery('麦茶 ミスター', ['やさしい麦茶', 'ミスターマックス'])).toBe(true);
    expect(matchesQuery('麦茶 イオン', ['やさしい麦茶', 'ミスターマックス'])).toBe(false);
  });
  it('検索語が空なら常に一致、項目が空でも落ちない', () => {
    expect(matchesQuery('', [])).toBe(true);
    expect(matchesQuery('a', [undefined, ''])).toBe(false);
  });
});

describe('商品・店舗の検索', () => {
  it('商品は品目・カテゴリ・メーカー・メモ・IDで探せる', () => {
    const found = (q: string) => mockProducts.filter((p) => productMatches(p, q)).map((p) => p.id);
    expect(found('ラップ')).toEqual(['P001', 'P002']);
    expect(found('日用品')).toEqual(['P001', 'P002', 'P003']);
    expect(found('サントリー')).toEqual(['P005']);
    expect(found('30cm')).toEqual(['P001', 'P002']);
    expect(found('p004')).toEqual(['P004']);
    expect(found('存在しない商品')).toEqual([]);
  });
  it('店舗は店舗名・種類・メモで探せる', () => {
    const found = (q: string) => mockStores.filter((s) => storeMatches(s, q)).map((s) => s.id);
    expect(found('ドン')).toEqual(['S003']);
    expect(found('ディスカウント')).toEqual(['S003', 'S004', 'S009']);
    expect(found('amazon')).toEqual(['S007']);
    expect(found('該当なし')).toEqual([]);
  });
  it('使用中／使用停止／すべて', () => {
    const items: (Product | Store)[] = [{ ...mockStores[0] }, { ...mockStores[1], archived: true }];
    expect(items.filter((i) => matchesStatus(i, 'active'))).toHaveLength(1);
    expect(items.filter((i) => matchesStatus(i, 'archived'))).toEqual([items[1]]);
    expect(items.filter((i) => matchesStatus(i, 'all'))).toHaveLength(2);
  });
});

describe('価格履歴の絞り込み', () => {
  const run = (f: Partial<typeof EMPTY_RECORD_FILTER>) => ids(filterRecords(mockPriceRecords, { ...EMPTY_RECORD_FILTER, ...f }, names));

  it('条件なしなら全件', () => {
    expect(run({})).toHaveLength(10);
  });
  it('商品名で検索', () => {
    expect(run({ query: '麦茶' })).toEqual(['R001', 'R003', 'R005', 'R010']);
  });
  it('店舗名で検索（同じ検索欄）', () => {
    expect(run({ query: 'コストコ' })).toEqual(['R006', 'R007', 'R008', 'R009']);
    expect(run({ query: 'ミスター' })).toEqual(['R001', 'R010']);
  });
  it('商品名と店舗名の組み合わせ', () => {
    expect(run({ query: '麦茶 イオン' })).toEqual(['R003']);
  });
  it('開始日のみ（その日を含む）', () => {
    expect(run({ from: '2026-09-21' })).toEqual(['R006', 'R007', 'R008', 'R009', 'R010']);
  });
  it('終了日のみ（その日を含む）', () => {
    expect(run({ to: '2026-09-05' })).toEqual(['R001', 'R002']);
  });
  it('開始日＋終了日（両端の日を含む）', () => {
    expect(run({ from: '2026-09-05', to: '2026-09-12' })).toEqual(['R002', 'R003', 'R004']);
    expect(run({ from: '2026-09-22', to: '2026-09-22' })).toEqual(['R010']);
  });
  it('開始日 > 終了日 は入れ替えて扱う', () => {
    expect(normalizePeriod('2026-09-12', '2026-09-05')).toEqual({ from: '2026-09-05', to: '2026-09-12', swapped: true });
    expect(run({ from: '2026-09-12', to: '2026-09-05' })).toEqual(['R002', 'R003', 'R004']);
    expect(normalizePeriod('2026-09-05', '').swapped).toBe(false);
  });
  it('検索語と期間の組み合わせ', () => {
    expect(run({ query: '麦茶', from: '2026-09-10', to: '2026-09-20' })).toEqual(['R003', 'R005']);
  });
  it('該当なしは0件', () => {
    expect(run({ query: '牛乳' })).toEqual([]);
    expect(run({ from: '2027-01-01' })).toEqual([]);
  });
  it('名前を変更しても、IDから新しい名前で検索できる', () => {
    const renamed = { ...names, store: (id: string) => (id === 'S009' ? 'MrMax' : names.store(id)) };
    expect(ids(filterRecords(mockPriceRecords, { ...EMPTY_RECORD_FILTER, query: 'mrmax' }, renamed))).toEqual(['R001', 'R010']);
  });
  it('条件が設定されているかどうか', () => {
    expect(isRecordFilterActive(EMPTY_RECORD_FILTER)).toBe(false);
    expect(isRecordFilterActive({ ...EMPTY_RECORD_FILTER, query: '  ' })).toBe(false);
    expect(isRecordFilterActive({ ...EMPTY_RECORD_FILTER, to: '2026-09-01' })).toBe(true);
  });
});

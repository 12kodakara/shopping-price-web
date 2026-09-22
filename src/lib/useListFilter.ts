import { useEffect, useState } from 'react';
import { paginate } from './pagination';
import { matchesStatus, searchTerms, type StatusFilter } from './search';

/**
 * 商品・店舗一覧の検索・「使用中／使用停止／すべて」・ページ（画面の一時的な状態。保存はしない）。
 * 既定は「使用中」。このときは従来どおり、使用停止中のものを別の折りたたみ欄（archivedExtra）に出す。
 *
 * 処理の順番: 全件 → 状態で絞り込み → 検索 → ページ分割。並び順は登録順（元の配列の順）のまま。
 * 検索語や状態を変えたら、必ず1ページ目に戻す。
 */
export function useListFilter<T extends { archived?: boolean }>(items: T[], matches: (item: T, query: string) => boolean) {
  const [query, setQueryState] = useState('');
  const [status, setStatusState] = useState<StatusFilter>('active');
  const [requestedPage, setPage] = useState(1);

  const inStatus = items.filter((i) => matchesStatus(i, status));
  const shown = inStatus.filter((i) => matches(i, query));
  const paged = paginate(shown, requestedPage);
  const hasQuery = searchTerms(query).length > 0;
  const archivedExtra = status === 'active' ? items.filter((i) => i.archived && matches(i, query)) : [];

  // 編集・使用停止などで件数が減り、今のページがなくなったら、存在する最後のページに合わせる
  useEffect(() => {
    if (paged.page !== requestedPage) setPage(paged.page);
  }, [paged.page, requestedPage]);

  return {
    query,
    setQuery(value: string) {
      setQueryState(value);
      setPage(1);
    },
    status,
    setStatus(value: StatusFilter) {
      setStatusState(value);
      setPage(1);
    },
    /** 検索・状態で絞り込んだ全件（ページ分割前） */
    shown,
    /** 表示中のページ */
    paged,
    setPage,
    /** 選んだ状態の件数（検索前） */
    total: inStatus.length,
    archivedExtra,
    hasQuery,
    /** 初期状態（検索語なし・使用中）から変わっているか */
    changed: hasQuery || status !== 'active',
    clear() {
      setQueryState('');
      setStatusState('active');
      setPage(1);
    },
  };
}

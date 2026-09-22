import type { ReactNode } from 'react';
import { formatCount } from '../lib/pagination';
import { STATUS_LABELS, type StatusFilter } from '../lib/search';

// 一覧の検索・絞り込み欄（商品・店舗・価格履歴で共通）。
// スマホでは「検索欄」→「状態の切り替え・件数・クリア」の2段にまとめ、一覧の表示領域をなるべく狭めない。

/** 検索欄 */
export function SearchField({ id, label, placeholder, value, onChange }: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="search-field">
      <label htmlFor={id} className="visually-hidden">{label}</label>
      <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <input
        id={id}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** 使用中／使用停止／すべて の切り替え */
export function StatusToggle({ name, value, onChange }: { name: string; value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="表示する状態">
      {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
        <label key={s} className={value === s ? 'is-selected' : ''}>
          <input type="radio" name={name} value={s} checked={value === s} onChange={() => onChange(s)} />
          <span>{STATUS_LABELS[s]}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * 件数とクリア。検索で絞り込んでいるときは「3 / 10件」、そうでなければ「10件」。
 * 複数ページのときは表示中の範囲も出す（例「全128件中 51〜100件」）。
 * クリアは条件が初期状態から変わっているときだけ出す。
 */
export function FilterSummary({ shown, total, filtered, canClear, onClear, testId, page }: {
  shown: number;
  total: number;
  filtered: boolean;
  canClear: boolean;
  onClear: () => void;
  testId: string;
  page?: { start: number; end: number; pageCount: number };
}) {
  const text = formatCount({ shown, total, filtered, start: page?.start ?? 1, end: page?.end ?? shown, pageCount: page?.pageCount ?? 1 });
  return (
    <div className="filter-summary">
      <span className="filter-count" data-testid={testId} aria-live="polite">
        {text}
      </span>
      {canClear && (
        <button type="button" className="button button-ghost button-sm" onClick={onClear}>
          クリア
        </button>
      )}
    </div>
  );
}

/** 検索欄と絞り込みをまとめる枠。id はページを移動したときのスクロール先に使う */
export function FilterBar({ children, label, id }: { children: ReactNode; label: string; id?: string }) {
  return (
    <div className="filter-bar" role="search" aria-label={label} id={id}>
      {children}
    </div>
  );
}

/**
 * ページ移動（前へ・次へ と現在位置だけ。ページ番号を並べないのでスマホでも1行に収まる）。
 * 1ページに収まるときは出さない。
 */
export function Pager({ page, pageCount, onChange, testId }: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  testId: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label="ページ" data-testid={testId}>
      <button type="button" className="button button-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ‹ 前へ
      </button>
      <span className="pager-status" aria-live="polite">
        {page} / {pageCount}ページ
      </span>
      <button type="button" className="button button-ghost" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        次へ ›
      </button>
    </nav>
  );
}

/** ページを移動したら、一覧の先頭（検索欄）が見える位置へ戻す */
export function scrollToListTop(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

/** 検索・絞り込みで0件になったときの表示（まだ何も登録されていない空状態とは別） */
export function NoMatch({ message, onClear, testId }: { message: string; onClear: () => void; testId: string }) {
  return (
    <div className="no-match" data-testid={testId}>
      <p>{message}</p>
      <button type="button" className="button button-outline button-sm" onClick={onClear}>
        検索条件をクリア
      </button>
    </div>
  );
}

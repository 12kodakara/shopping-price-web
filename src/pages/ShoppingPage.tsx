import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge, DiffBadge, PageHeader, Price, useNotice } from '../components/ui';
import { repository } from '../data/repository';
import type { ProductId } from '../data/types';
import { useAppData } from '../data/useAppData';
import { usePersistentFlag } from '../lib/prefs';
import { buildCompareRows, buildShoppingCandidates, compareTargets, formatYen, storeName, type CompareRow } from '../lib/price';
import { buildShoppingList, type ShoppingItem } from '../lib/shopping';
import {
  ariaSort,
  directionLabel,
  directionToggleLabel,
  nextSortState,
  noSort,
  sortMark,
  sortRows,
  type SortKind,
  type SortState,
} from '../lib/tableSort';
import { PC_QUERY, useMediaQuery } from '../lib/useMediaQuery';

export function ShoppingPage() {
  const data = useAppData();
  const { stores } = data;
  const notice = useNotice();
  const targets = compareTargets(data);
  const candidates = buildShoppingCandidates(buildCompareRows(targets.products, targets.records));
  const { groups, progress } = buildShoppingList(data);
  const listed = new Set(groups.flatMap((g) => g.items.map((i) => i.product.id)));
  const [hidePurchased, setHidePurchased] = usePersistentFlag('hide-purchased', false);
  const [confirmReset, setConfirmReset] = useState(false);

  // 第19回: 買い物候補を一覧表（PC）とコンパクトなカード（スマホ）で出し分ける
  const isPc = useMediaQuery(PC_QUERY);
  const [sort, setSort] = useState<SortState<CandidateColumn>>(noSort<CandidateColumn>());
  const candidateRows = sortRows(candidates, sort, {
    selected: (r) => listed.has(r.product.id),
    name: (r) => r.product.name,
    category: (r) => r.product.category,
    store: (r) => (r.cheapest ? storeName(stores, r.cheapest.storeId) : null),
    unitPrice: (r) => r.cheapest?.unitPrice ?? null,
    target: (r) => r.product.targetUnitPrice,
    diff: (r) => r.targetDiff,
    pastLowest: (r) => isPastLowest(r),
  });

  /** いま並び替えに使っている項目の種類（文言を「安い順／昇順」などに切り替えるために使う） */
  const sortKind = CANDIDATE_COLUMNS.find((c) => c.key === sort.key)?.kind ?? null;

  const allDone = progress.total > 0 && progress.remaining === 0;
  const visibleGroups = groups
    .map((g) => ({ ...g, items: hidePurchased ? g.items.filter((i) => !i.purchased) : g.items }))
    .filter((g) => g.items.length > 0);

  function report(result: { ok: true } | { ok: false; error: string }) {
    if (!result.ok) notice.show(result.error, 'error');
  }

  function toggleSelected(id: ProductId) {
    report(repository.setShoppingSelected(id, !listed.has(id)));
  }

  return (
    <>
      <PageHeader title="買い物候補" description="今回買う商品を選び、お店では買ったものにチェックします。" />
      {notice.node}

      <section className="shopping-list" aria-labelledby="shopping-list-heading" data-testid="shopping-list">
        <h2 id="shopping-list-heading">今回の買い物リスト</h2>

        {progress.total === 0 ? (
          <div className="list-empty" data-testid="shopping-list-empty">
            <p>買い物リストは空です。下の「買い物候補」で「今回買う」を押すと、ここに入ります。</p>
            {candidates.length > 0 && (
              <button
                type="button"
                className="button button-outline"
                onClick={() => report(repository.addAllToShoppingList(candidates.map((c) => c.product.id)))}
              >
                候補{candidates.length}件をすべてリストに入れる
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="list-toolbar">
              <div className="list-progress" data-testid="shopping-progress" aria-live="polite">
                <span>
                  <strong>{progress.purchased} / {progress.total}</strong> 購入済み
                </span>
                {allDone ? (
                  <span className="progress-done">✓ 買い物完了</span>
                ) : (
                  <span className="muted">残り{progress.remaining}件</span>
                )}
                <span className="progress-track" aria-hidden="true">
                  <span className="progress-fill" style={{ width: `${(progress.purchased / progress.total) * 100}%` }} />
                </span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={hidePurchased}
                  onChange={(e) => setHidePurchased(e.target.checked)}
                  data-testid="hide-purchased"
                />
                <span>購入済みを非表示</span>
              </label>
            </div>

            {allDone && (
              <div className="list-complete" data-testid="shopping-complete">
                <strong>✓ 買い物完了</strong>
                <span>{progress.total}件すべて購入済みです。</span>
              </div>
            )}

            {visibleGroups.map((g) => (
              <div key={g.storeId ?? 'none'} className="store-group" data-testid={`store-group-${g.storeId ?? 'none'}`}>
                <h3 className="store-heading">
                  <span>{g.storeId ? storeName(stores, g.storeId) : '店舗未定（価格の記録なし）'}</span>
                  <span className="muted small">
                    {g.items.filter((i) => !i.purchased).length === 0 ? '購入済み' : `残り${g.items.filter((i) => !i.purchased).length}件`}
                  </span>
                </h3>
                <ul className="check-list">
                  {g.items.map((item) => (
                    <CheckRow
                      key={item.product.id}
                      item={item}
                      onToggle={() => report(repository.setPurchased(item.product.id, !item.purchased))}
                      onRemove={() => report(repository.setShoppingSelected(item.product.id, false))}
                    />
                  ))}
                </ul>
              </div>
            ))}

            {hidePurchased && progress.purchased > 0 && !allDone && (
              <p className="muted small" data-testid="hidden-note">購入済み{progress.purchased}件を非表示にしています。</p>
            )}

            {progress.purchased > 0 && (
              <div className="list-footer">
                <button type="button" className="button button-ghost button-sm" onClick={() => setConfirmReset(true)}>
                  すべて未購入に戻す
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {confirmReset && (
        <ConfirmDialog
          message="すべての商品を未購入に戻しますか？"
          confirmLabel="未購入に戻す"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            const r = repository.resetPurchased();
            notice.show(r.ok ? 'すべて未購入に戻しました' : r.error, r.ok ? 'success' : 'error');
          }}
        />
      )}

      <section className="candidates" aria-labelledby="candidates-heading">
        <h2 id="candidates-heading">買い物候補（目安単価以下）</h2>
        <p className="muted small">最安単価が目安単価以下の商品です。お得な順に並んでいます。在庫や必要かどうかも確認してください。</p>

        <div className="summary-bar">
          <span>目安以下の商品：<strong data-testid="candidate-count">{candidates.length}</strong>件</span>
          <span>今回買う：<strong data-testid="selected-count">{progress.total}</strong>件</span>
        </div>

        {/* スマホはカード表示で見出しがないため、ここで並び替えを選ぶ（PCは表の見出しで並び替える） */}
        {!isPc && candidates.length > 0 && (
          <div className="sort-control" data-testid="candidate-sort-control">
            <label htmlFor="candidate-sort-select" className="sort-control-label">並び替え</label>
            <div className="sort-control-row">
              <select
                id="candidate-sort-select"
                className="sort-control-select"
                value={sort.key ?? ''}
                onChange={(e) => {
                  const key = e.target.value as CandidateColumn | '';
                  setSort(key === '' ? noSort<CandidateColumn>() : { key, direction: 'asc' });
                }}
              >
                <option value="">お得な順（標準）</option>
                {CANDIDATE_COLUMNS.map((col) => (
                  <option key={col.key} value={col.key}>{col.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="button button-sm sort-control-direction"
                disabled={sort.key === null}
                aria-label={sortKind === null ? '並び替える項目を選ぶと使えます' : directionToggleLabel(sortKind, sort.direction)}
                onClick={() => setSort((current) => ({ ...current, direction: current.direction === 'asc' ? 'desc' : 'asc' }))}
                data-testid="candidate-sort-direction"
              >
                {sortKind === null ? '↕ 並び順' : directionLabel(sortKind, sort.direction)}
              </button>
            </div>
          </div>
        )}

        {candidates.length === 0 ? (
          <p className="card muted" data-testid="no-candidates">目安単価以下の商品はまだありません。価格を登録すると、ここに表示されます。</p>
        ) : isPc ? (
          /* PC: 一覧表。縦に長くならず、金額を並べて比べられる */
          <div className="card table-wrap">
            <table className="table candidate-table" data-testid="candidate-table">
              <thead>
                <tr>
                  {CANDIDATE_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={col.numeric ? 'num' : undefined}
                      aria-sort={ariaSort(sort, col.key)}
                    >
                      <button
                        type="button"
                        className="sort-button"
                        onClick={() => setSort((current) => nextSortState(current, col.key))}
                        data-testid={`candidate-sort-${col.key}`}
                      >
                        {col.label}
                        <span className="sort-mark" aria-hidden="true">{sortMark(sort, col.key)}</span>
                      </button>
                    </th>
                  ))}
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody data-testid="candidate-list">
                {candidateRows.map((r) => {
                  const isSelected = listed.has(r.product.id);
                  return (
                    <tr key={r.product.id} data-testid={`candidate-${r.product.id}`} className={isSelected ? 'row-selected' : undefined}>
                      <td>
                        <button
                          type="button"
                          className={`button button-sm button-buy ${isSelected ? 'button-added' : 'button-primary'}`}
                          aria-pressed={isSelected}
                          onClick={() => toggleSelected(r.product.id)}
                        >
                          {isSelected ? '✓ 今回買う' : '＋ 今回買う'}
                        </button>
                      </td>
                      <td>{r.product.name}</td>
                      <td className="muted small">{r.product.category}</td>
                      <td>{r.cheapest ? storeName(stores, r.cheapest.storeId) : '—'}</td>
                      <td className="num"><Price value={r.cheapest?.unitPrice ?? null} unit={r.product.unit} size="sm" /></td>
                      <td className="num"><Price value={r.product.targetUnitPrice} unit={r.product.unit} size="sm" /></td>
                      <td className="num"><DiffBadge diff={r.targetDiff} /></td>
                      <td>{isPastLowest(r) ? <Badge kind="best">過去最安</Badge> : <span className="muted">—</span>}</td>
                      <td>
                        <Link to={`/prices/new?product=${r.product.id}`} className="button button-ghost button-sm">価格を登録</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* スマホ: 横に広い表は見づらいので、1商品1枚のコンパクトなカード */
          <ul className="card-list" data-testid="candidate-list">
            {candidateRows.map((r) => {
              const isSelected = listed.has(r.product.id);
              return (
                <li key={r.product.id} data-testid={`candidate-${r.product.id}`} className={`card item-card card-good${isSelected ? ' card-selected' : ''}`}>
                  <div className="item-card-head">
                    <span className="item-card-title">{r.product.name}</span>
                    <span className="muted small">{r.product.category}</span>
                  </div>
                  <dl className="kv">
                    <div>
                      <dt>最安店</dt>
                      <dd>{r.cheapest ? storeName(stores, r.cheapest.storeId) : '—'}</dd>
                    </div>
                    <div>
                      <dt>最安単価</dt>
                      <dd><Price value={r.cheapest?.unitPrice ?? null} unit={r.product.unit} /></dd>
                    </div>
                    <div>
                      <dt>目安単価</dt>
                      <dd><Price value={r.product.targetUnitPrice} unit={r.product.unit} size="sm" /></dd>
                    </div>
                  </dl>
                  <div className="chips">
                    <DiffBadge diff={r.targetDiff} />
                    {isPastLowest(r) && <Badge kind="best">過去最安</Badge>}
                  </div>
                  <div className="card-actions candidate-actions">
                    {/* この画面の主な操作は「今回買う」（買い物リストへの追加）。押した後は控えめな表示に変わる */}
                    <button
                      type="button"
                      className={`button button-buy ${isSelected ? 'button-added' : 'button-primary'}`}
                      aria-pressed={isSelected}
                      onClick={() => toggleSelected(r.product.id)}
                    >
                      {isSelected ? '✓ 今回買う' : '＋ 今回買う'}
                    </button>
                    <Link to={`/prices/new?product=${r.product.id}`} className="button button-ghost button-register">価格を登録</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * 買い物リストの1行。行全体がチェックの操作範囲（片手で押しやすいように）。
 * 「外す」ボタンは、候補一覧から外せない商品（値上がりして目安を超えた・価格の記録がない）にだけ出す。
 */
function CheckRow({ item, onToggle, onRemove }: { item: ShoppingItem; onToggle: () => void; onRemove: () => void }) {
  const { product } = item;
  const id = `check-${product.id}`;
  return (
    <li className={`check-item${item.purchased ? ' is-purchased' : ''}`} data-testid={`list-item-${product.id}`}>
      <label className="check-row" htmlFor={id}>
        <input id={id} type="checkbox" className="check-box" checked={item.purchased} onChange={onToggle} />
        <span className="check-body">
          <span className="check-name">{product.name}</span>
          <span className="check-meta">
            {item.unitPrice !== null ? (
              <>
                <span className="check-price">{formatYen(item.unitPrice)}円/{product.unit}</span>
                {product.targetUnitPrice !== null && <span className="muted">目安{formatYen(product.targetUnitPrice)}円</span>}
                {!item.isCandidate && item.targetDiff !== null && <Badge kind="warn">目安超え</Badge>}
              </>
            ) : (
              <Badge kind="neutral">価格未登録</Badge>
            )}
          </span>
          {/* 第16回: お店では値札（数量と価格）で見比べるので、単価に加えて実際の金額も出す */}
          {item.shelf && (
            <span className="check-shelf" data-testid={`shelf-${product.id}`}>
              前回 {formatYen(item.shelf.price)}円／{formatYen(item.shelf.quantity)}
              {product.unit}
              {item.buyBelow !== null && <strong>・{formatYen(item.buyBelow)}円以下なら目安どおり</strong>}
            </span>
          )}
        </span>
      </label>
      {!item.isCandidate && (
        <button type="button" className="button button-ghost button-sm check-remove" onClick={onRemove} aria-label={`${product.name}をリストから外す`}>
          外す
        </button>
      )}
    </li>
  );
}

/** 買い物候補の一覧表で並び替えできる列 */
type CandidateColumn = 'selected' | 'name' | 'category' | 'store' | 'unitPrice' | 'target' | 'diff' | 'pastLowest';

const CANDIDATE_COLUMNS: { key: CandidateColumn; label: string; kind: SortKind; numeric?: boolean }[] = [
  { key: 'selected', label: '今回買う', kind: 'flag' },
  { key: 'name', label: '商品名', kind: 'text' },
  { key: 'category', label: 'カテゴリ', kind: 'text' },
  { key: 'store', label: '最安店', kind: 'text' },
  { key: 'unitPrice', label: '最安単価', kind: 'number', numeric: true },
  { key: 'target', label: '目安単価', kind: 'number', numeric: true },
  { key: 'diff', label: '目安との差', kind: 'number', numeric: true },
  { key: 'pastLowest', label: '過去最安', kind: 'flag' },
];

/** いまの最安単価が、これまでの最安と同じかそれより安いか */
function isPastLowest(row: CompareRow): boolean {
  return row.cheapest !== null && row.pastLowest !== null && row.cheapest.unitPrice <= row.pastLowest;
}

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterBar, FilterSummary, NoMatch, Pager, scrollToListTop, SearchField } from '../components/ListFilter';
import { PriceRecordEditor } from '../components/PriceRecordEditor';
import { Badge, PageHeader, Price, useNotice } from '../components/ui';
import { useAppData } from '../data/useAppData';
import {
  buildHistory,
  compareRecordsOldestFirst,
  formatShortDate,
  formatYen,
  recentlyRegistered,
  recordUnitPrice,
  storeName,
  type HistoryPoint,
} from '../lib/price';
import { pageOfIndex, paginate } from '../lib/pagination';
import { EMPTY_RECORD_FILTER, filterRecords, isRecordFilterActive, normalizePeriod, type RecordFilter } from '../lib/search';

/** 商品の選択肢「すべての商品」の値（商品IDは P で始まるので重ならない） */
const ALL = 'all';

/** 差額の表示（マイナス＝安くなった） */
function Change({ value, zeroLabel }: { value: number | null; zeroLabel: string }) {
  if (value === null) return <span className="price price-md price-empty">—</span>;
  const cls = value < 0 ? 'change-down' : value > 0 ? 'change-up' : '';
  return (
    <span className={`price price-md ${cls}`}>
      <span className="price-num">{value === 0 ? zeroLabel : `${value > 0 ? '+' : '−'}${formatYen(Math.abs(value))}`}</span>
      {value !== 0 && <span className="price-unit">円</span>}
    </span>
  );
}

export function HistoryPage() {
  const { products, stores, priceRecords } = useAppData();
  const [params, setParams] = useSearchParams();
  const notice = useNotice();
  // 検索・期間の条件は画面の一時的な状態（保存しない）。商品を切り替えても条件は残す
  const [filter, setFilter] = useState<RecordFilter>(EMPTY_RECORD_FILTER);

  // 選択中の商品: URL の ?product= → 最後に価格を登録した商品 → 先頭の商品。"all" は全商品の記録
  const requested = params.get('product');
  const lastRegistered = useMemo(() => recentlyRegistered(priceRecords, 1)[0]?.productId, [priceRecords]);
  const fallback = lastRegistered ?? products[0]?.id ?? '';
  const allMode = requested === ALL;
  const productId = allMode ? ALL : requested && products.some((p) => p.id === requested) ? requested : fallback;
  const product = allMode ? undefined : products.find((p) => p.id === productId);
  const history = useMemo(() => (product ? buildHistory(product, priceRecords) : null), [product, priceRecords]);
  const unit = product?.unit;

  // ID → 名前・商品 の引き当て（記録ごとに一覧を探し直さないよう Map にする）
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);
  const productName = (id: string) => productById.get(id)?.name;
  const storeNameOf = (id: string) => storeById.get(id)?.name ?? '（不明な店舗）';

  // 一覧に出す記録。処理の順番: 対象の全記録 → 検索・期間で絞り込み → 新しい順に並べ替え → ページ分割
  const baseRecords = useMemo(
    () => (allMode ? priceRecords : priceRecords.filter((r) => r.productId === productId)),
    [allMode, priceRecords, productId],
  );
  const shownRecords = useMemo(
    () =>
      filterRecords(baseRecords, filter, { product: (id) => productById.get(id)?.name, store: (id) => storeById.get(id)?.name })
        .sort(compareRecordsOldestFirst)
        .reverse(),
    [baseRecords, filter, productById, storeById],
  );
  const filterActive = isRecordFilterActive(filter);
  const period = normalizePeriod(filter.from, filter.to);

  // 修正中の記録（URL の ?edit= で保持するので、価格登録後の「修正する」から直接開ける）
  const editingId = params.get('edit');
  const editing = baseRecords.find((r) => r.id === editingId) ?? null;

  // ページ（商品を切り替えたら1ページ目）。修正中の記録があれば、その記録のあるページを表示する
  const [pageState, setPageState] = useState({ key: productId, page: 1 });
  const requestedPage = pageState.key === productId ? pageState.page : 1;
  const editingIndex = editing ? shownRecords.findIndex((r) => r.id === editing.id) : -1;
  const paged = paginate(shownRecords, editingIndex >= 0 ? pageOfIndex(editingIndex) : requestedPage);
  const setPage = (page: number) => setPageState({ key: productId, page });

  // 削除などで今のページがなくなったら、存在する最後のページに合わせる
  useEffect(() => {
    if (editingIndex < 0 && pageState.key === productId && paged.page !== pageState.page) {
      setPageState({ key: productId, page: paged.page });
    }
  }, [editingIndex, pageState, productId, paged.page]);

  function openEditor(recordId: string | null) {
    const next: Record<string, string> = { product: productId };
    if (recordId) next.edit = recordId;
    // 修正を閉じても、いま見ているページのままにする
    if (!recordId) setPage(paged.page);
    setParams(next, { replace: true });
  }

  // 検索語・期間を変えたら1ページ目に戻す
  const set = (key: keyof RecordFilter, value: string) => {
    setFilter((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const clearFilter = () => {
    setFilter(EMPTY_RECORD_FILTER);
    setPage(1);
  };

  const stat = (label: string, point: HistoryPoint | null, testId: string) => (
    <div className="stat-box" data-testid={testId}>
      <span className="result-label">{label}</span>
      <Price value={point?.unitPrice ?? null} unit={unit} />
      <span className="muted small">{point ? `${formatShortDate(point.record.date)} ${storeName(stores, point.record.storeId)}` : '—'}</span>
    </div>
  );

  return (
    <>
      <PageHeader title="価格履歴" description="商品を選ぶと、これまでに記録した価格の推移を確認できます。記録の検索・修正・削除もここで行います。" />
      {notice.node}

      <div className="card form-card">
        <div className="field">
          <label htmlFor="history-product">商品を選択</label>
          <select
            id="history-product"
            value={productId}
            onChange={(e) => setParams({ product: e.target.value }, { replace: true })}
          >
            <option value={ALL}>すべての商品（記録を検索）</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}（{p.id}）{p.archived ? '［使用停止］' : ''}</option>
            ))}
          </select>
        </div>
        {product && (
          <p className="muted small">
            {product.category}／{product.unitAmount}{product.unit}あたりの単価で比較
            {product.archived && <>　<Badge kind="neutral">使用停止中</Badge></>}
          </p>
        )}
        {allMode && <p className="muted small">全商品の価格記録を、新しい順に表示しています。</p>}
      </div>

      {history && (
        <>
          <section className="stat-grid" aria-label="価格の概要">
            {stat('現在単価', history.current, 'hist-current')}
            {stat('前回単価', history.previous, 'hist-previous')}
            <div className="stat-box" data-testid="hist-change">
              <span className="result-label">前回比</span>
              <Change value={history.changeFromPrevious} zeroLabel="変わらず" />
              <span className="muted small">{history.changeFromPrevious === null ? '記録2件から表示' : '現在 − 前回'}</span>
            </div>
            {stat('過去最安', history.lowest, 'hist-lowest')}
            {stat('過去最高', history.highest, 'hist-highest')}
            <div className="stat-box" data-testid="hist-lowest-diff">
              <span className="result-label">過去最安との差</span>
              <Change value={history.diffFromLowest} zeroLabel="最安" />
              <span className="muted small">現在 − 過去最安</span>
            </div>
            <div className="stat-box" data-testid="hist-count">
              <span className="result-label">記録件数</span>
              <span className="price price-md"><span className="price-num">{history.count}</span><span className="price-unit">件</span></span>
            </div>
          </section>

          <section className="card">
            <h2>価格推移</h2>
            <TrendChart points={history.points} target={product?.targetUnitPrice ?? null} />
          </section>
        </>
      )}

      {(history || allMode) && (
        <section className="card" aria-labelledby="record-list-heading">
          <h2 id="record-list-heading">記録一覧</h2>

          {baseRecords.length > 0 && (
            <FilterBar label="価格履歴の検索" id="record-list-top">
              <SearchField id="record-search" label="価格履歴を検索" placeholder="商品名・店舗名で検索" value={filter.query} onChange={(v) => set('query', v)} />
              <div className="period">
                <label className="period-field">
                  <span>開始日</span>
                  <input type="date" value={filter.from} onChange={(e) => set('from', e.target.value)} />
                </label>
                <span className="period-sep" aria-hidden="true">〜</span>
                <label className="period-field">
                  <span>終了日</span>
                  <input type="date" value={filter.to} onChange={(e) => set('to', e.target.value)} />
                </label>
              </div>
              {period.swapped && (
                <p className="period-warning" role="note" data-testid="period-swapped">
                  開始日が終了日より後のため、{period.from} 〜 {period.to} として絞り込んでいます。
                </p>
              )}
              <FilterSummary
                shown={shownRecords.length}
                total={baseRecords.length}
                filtered={filterActive}
                canClear={filterActive}
                onClear={clearFilter}
                testId="record-count"
                page={paged}
              />
              {filterActive && history && <p className="muted small filter-note">※ 上の集計とグラフは全期間の記録です。</p>}
            </FilterBar>
          )}

          {baseRecords.length === 0 ? (
            <p className="muted">{allMode ? '価格の記録がまだありません。' : 'まだ記録がありません。'}</p>
          ) : shownRecords.length === 0 ? (
            <NoMatch message="該当する価格履歴がありません" onClear={clearFilter} testId="record-no-match" />
          ) : (
            <>
            <ul className="list" data-testid="history-list">
              {paged.items.map((record) => {
                const recProduct = productById.get(record.productId);
                const recUnit = recProduct?.unit;
                const unitPrice = recProduct ? recordUnitPrice(record, recProduct) : null;
                const where = `${formatShortDate(record.date)} ${storeNameOf(record.storeId)}`;
                return editing?.id === record.id ? (
                  <li key={record.id} className="list-row list-row-editing" data-testid="history-item">
                    <PriceRecordEditor
                      record={editing}
                      products={products}
                      stores={stores}
                      onCancel={() => openEditor(null)}
                      onError={(m) => notice.show(m, 'error')}
                      onSaved={(r) => {
                        if (!allMode && r.productId !== productId) {
                          // 商品を変えた場合は、移動先の商品の履歴を表示する
                          setParams({ product: r.productId }, { replace: true });
                          notice.show(`${r.id} を修正し、${productName(r.productId) ?? r.productId} の履歴へ移しました`, 'success');
                        } else {
                          openEditor(null);
                          notice.show(`${r.id} を修正しました`, 'success');
                        }
                      }}
                      onDeleted={(r) => {
                        openEditor(null);
                        notice.show(`${r.id} を削除しました`, 'success');
                      }}
                    />
                  </li>
                ) : (
                  <li key={record.id} className="list-row" data-testid="history-item">
                    <div className="list-main">
                      {allMode ? (
                        <>
                          <span className="list-title">{recProduct?.name ?? record.productId}</span>
                          <span className="muted small">{where}</span>
                        </>
                      ) : (
                        <span className="list-title">{where}</span>
                      )}
                      <span className="muted small">{formatYen(record.quantity)}{recUnit} {formatYen(record.price)}円{record.note ? `・${record.note}` : ''}</span>
                      {record.updatedAt && <span className="muted small">修正済み</span>}
                    </div>
                    <div className="list-side list-side-row">
                      <div className="list-side">
                        <Price value={unitPrice} unit={recUnit} />
                        {record.sale && <Badge kind="sale">セール</Badge>}
                        {history?.lowest?.record.id === record.id && <Badge kind="best">最安</Badge>}
                      </div>
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        aria-label={`${where}の記録（${record.id}）を修正`}
                        onClick={() => openEditor(record.id)}
                      >
                        修正
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pager
              page={paged.page}
              pageCount={paged.pageCount}
              testId="record-pager"
              onChange={(p) => {
                if (editing) setParams({ product: productId }, { replace: true });
                setPage(p);
                scrollToListTop('record-list-top');
              }}
            />
            </>
          )}
        </section>
      )}
    </>
  );
}

/**
 * 価格推移の仮表示。グラフライブラリは導入せず、簡単なSVGの折れ線で表示する。
 * 本格的なグラフ（期間切替・店舗別など）は次回以降に検討。
 */
function TrendChart({ points, target }: { points: HistoryPoint[]; target: number | null }) {
  if (points.length < 2) {
    return <div className="chart-placeholder">記録が2件以上になると推移を表示します</div>;
  }
  const W = 420;
  const H = 220;
  const pad = { l: 44, r: 28, t: 16, b: 40 };
  const values = points.map((p) => p.unitPrice).concat(target ?? []);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v: number) => pad.t + ((max - v) * (H - pad.t - pad.b)) / span;
  const line = points.map((p, i) => `${x(i)},${y(p.unitPrice)}`).join(' ');

  return (
    <div className="chart" data-testid="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="単価の推移">
        <text x={pad.l - 6} y={y(max) + 4} textAnchor="end" className="chart-axis">{formatYen(max)}</text>
        <text x={pad.l - 6} y={y(min) + 4} textAnchor="end" className="chart-axis">{formatYen(min)}</text>
        {target !== null && (
          <>
            <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} className="chart-target" />
            <text x={W - pad.r} y={y(target) - 4} textAnchor="end" className="chart-axis">目安 {formatYen(target)}</text>
          </>
        )}
        <polyline points={line} className="chart-line" />
        {points.map((p, i) => (
          <g key={p.record.id}>
            <circle cx={x(i)} cy={y(p.unitPrice)} r={4} className="chart-dot" />
            <text x={x(i)} y={H - 10} textAnchor="middle" className="chart-axis">{formatShortDate(p.record.date)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

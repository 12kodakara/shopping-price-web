import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge, DiffBadge, PageHeader, Price, useNotice } from '../components/ui';
import { repository } from '../data/repository';
import type { ProductId } from '../data/types';
import { useAppData } from '../data/useAppData';
import { usePersistentFlag } from '../lib/prefs';
import { buildCompareRows, buildShoppingCandidates, compareTargets, formatYen, storeName } from '../lib/price';
import { buildShoppingList, type ShoppingItem } from '../lib/shopping';

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

        {candidates.length === 0 ? (
          <p className="card muted" data-testid="no-candidates">目安単価以下の商品はまだありません。価格を登録すると、ここに表示されます。</p>
        ) : (
          <ul className="card-list" data-testid="candidate-list">
            {candidates.map((r) => {
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
                    {r.cheapest && r.pastLowest !== null && r.cheapest.unitPrice <= r.pastLowest && <Badge kind="best">過去最安</Badge>}
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

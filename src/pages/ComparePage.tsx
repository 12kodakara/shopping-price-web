import { Link } from 'react-router-dom';
import { Badge, DiffBadge, PageHeader, Price } from '../components/ui';
import { useAppData } from '../data/useAppData';
import { buildCompareRows, compareTargets, storeName } from '../lib/price';
import { PC_QUERY, useMediaQuery } from '../lib/useMediaQuery';

export function ComparePage() {
  const data = useAppData();
  const { stores } = data;
  const { products, records } = compareTargets(data);
  const rows = buildCompareRows(products, records);
  // 表（PC）とカード（スマホ）は、画面幅に合う方だけを描画する（商品が多いと両方の描画は重いため）
  const isPc = useMediaQuery(PC_QUERY);
  const archivedCount = data.products.length - products.length;

  return (
    <>
      <PageHeader title="価格比較" description="各店舗の最新価格のうち、一番安い単価を比較します。" />

      {/* PC: 表形式 */}
      {isPc && (
        <div className="card table-wrap only-pc">
          <table className="table" data-testid="compare-table">
            <thead>
              <tr>
                <th>商品</th>
                <th>比較単位</th>
                <th>最安店</th>
                <th className="num">最安単価</th>
                <th className="num">目安単価</th>
                <th>目安との差</th>
                <th className="num">比較店舗数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product.id} data-testid={`compare-row-${r.product.id}`} className={r.targetDiff !== null && r.targetDiff <= 0 ? 'row-good' : ''}>
                  <td>
                    <span className="id-tag">{r.product.id}</span> {r.product.name}
                  </td>
                  <td>{r.product.unitAmount}{r.product.unit}あたり</td>
                  <td>{r.cheapest ? <>{storeName(stores, r.cheapest.storeId)} <Badge kind="best">最安</Badge></> : '—'}</td>
                  <td className="num"><Price value={r.cheapest?.unitPrice ?? null} /></td>
                  <td className="num"><Price value={r.product.targetUnitPrice} size="sm" /></td>
                  <td><DiffBadge diff={r.targetDiff} hasTarget={r.product.targetUnitPrice !== null} /></td>
                  <td className="num">{r.storePrices.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* スマホ: カード形式 */}
      {!isPc && (
        <ul className="card-list only-sp" data-testid="compare-cards">
          {rows.map((r) => (
            <li key={r.product.id} data-testid={`compare-card-${r.product.id}`} className={`card item-card${r.targetDiff !== null && r.targetDiff <= 0 ? ' card-good' : ''}`}>
              <div className="item-card-head">
                <span className="item-card-title">{r.product.name}</span>
                <span className="id-tag">{r.product.id}</span>
              </div>
              <div className="compare-line">
                <div>
                  <span className="result-label">最安単価（{r.product.unit}）</span>
                  <Price value={r.cheapest?.unitPrice ?? null} size="lg" />
                </div>
                <div className="compare-side">
                  <span className="result-label">目安</span>
                  <Price value={r.product.targetUnitPrice} size="sm" />
                </div>
              </div>
              <div className="chips">
                {r.cheapest && <Badge kind="best">最安：{storeName(stores, r.cheapest.storeId)}</Badge>}
                <DiffBadge diff={r.targetDiff} hasTarget={r.product.targetUnitPrice !== null} />
              </div>
              {r.storePrices.length > 1 && (
                <details className="store-prices">
                  <summary>店舗別の最新単価（{r.storePrices.length}店）</summary>
                  <ul>
                    {r.storePrices.map((sp) => (
                      <li key={sp.storeId}>
                        <span>{storeName(stores, sp.storeId)}</span>
                        <Price value={sp.unitPrice} size="sm" />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {archivedCount > 0 && (
        <p className="muted small">使用停止中の商品（{archivedCount}件）と、使用停止中の店舗の価格は比較に含めていません。</p>
      )}
      <p className="muted small">
        新しい価格を見つけたら <Link to="/prices/new" className="text-link">価格登録</Link> へ。
      </p>
    </>
  );
}

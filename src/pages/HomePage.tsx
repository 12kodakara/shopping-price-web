import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Badge, PageHeader, Price } from '../components/ui';
import { useAppData } from '../data/useAppData';
import { buildCompareRows, buildShoppingCandidates, compareTargets, formatShortDate, recentlyRegistered, recordUnitPrice, storeName } from '../lib/price';

export function HomePage() {
  const data = useAppData();
  const { products, stores, priceRecords } = data;
  const targets = compareTargets(data);
  const candidates = buildShoppingCandidates(buildCompareRows(targets.products, targets.records));
  const activeProducts = targets.products.length;
  const activeStores = stores.filter((s) => !s.archived).length;
  const recent = recentlyRegistered(priceRecords, 5);

  return (
    <>
      <PageHeader title="ホーム" description="お店で見た価格をすぐ登録して、目安より安いかを確認できます。" />

      <Link to="/prices/new" className="button button-primary button-hero">
        <Icon name="plus" size={26} />
        価格を登録
      </Link>

      <section className="stats" aria-label="集計">
        <Link to="/shopping" className="stat stat-highlight" data-testid="stat-shopping">
          <span className="stat-label">買い物候補</span>
          <span className="stat-value">{candidates.length}<small>件</small></span>
        </Link>
        <Link to="/products" className="stat" data-testid="stat-products">
          <span className="stat-label">登録商品</span>
          <span className="stat-value">{activeProducts}<small>件</small></span>
        </Link>
        <Link to="/stores" className="stat" data-testid="stat-stores">
          <span className="stat-label">登録店舗</span>
          <span className="stat-value">{activeStores}<small>店</small></span>
        </Link>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>最近登録した価格</h2>
          <Link to="/history" className="text-link">価格履歴へ</Link>
        </div>
        <ul className="list" data-testid="recent-list">
          {recent.map((r) => {
            const product = products.find((p) => p.id === r.productId);
            if (!product) return null;
            const unitPrice = recordUnitPrice(r, product);
            const isGood = unitPrice !== null && product.targetUnitPrice !== null && unitPrice <= product.targetUnitPrice;
            return (
              <li key={r.id} className="list-row" data-testid="recent-item">
                <div className="list-main">
                  <span className="list-title">{product.name}</span>
                  <span className="muted small">
                    {formatShortDate(r.date)}・{storeName(stores, r.storeId)}・{r.quantity}{product.unit} {r.price.toLocaleString('ja-JP')}円
                  </span>
                </div>
                <div className="list-side">
                  <Price value={unitPrice} unit={product.unit} />
                  {isGood && <Badge kind="good">目安以下</Badge>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Combobox, type ComboOption } from '../components/Combobox';
import { Badge, DiffBadge, errorProps, FieldError, PageHeader, Price, useNotice } from '../components/ui';
import { repository } from '../data/repository';
import type { PriceRecord } from '../data/types';
import { useAppData } from '../data/useAppData';
import { buildCompareRows, calcDiff, calcUnitPrice, compareTargets, formatYen, storeName } from '../lib/price';
import { localDateString } from '../lib/date';
import { hasErrors, validatePriceForm, type PriceForm } from '../lib/validation';

const today = () => localDateString();

/** 保存直後に同じボタンが再度押されても無視する時間（二重クリック対策） */
const RESUBMIT_GUARD_MS = 1500;

export function PriceNewPage() {
  const data = useAppData();
  const { products, stores } = data;
  // 新しく登録するときは、使用停止の商品・店舗は選べない
  const activeProducts = products.filter((p) => !p.archived);
  const activeStores = stores.filter((s) => !s.archived);
  // 検索付き選択欄の候補（保存に使うのはID。補足欄もキーワード検索の対象）
  const productOptions: ComboOption[] = activeProducts.map((p) => ({
    value: p.id,
    label: p.name,
    detail: [p.id, p.category, p.maker].filter(Boolean).join('・'),
  }));
  const storeOptions: ComboOption[] = activeStores.map((st) => ({ value: st.id, label: st.name, detail: st.type }));
  // 入力のたびに作り直さないよう、保存データが変わったときだけ計算する
  const targets = useMemo(() => compareTargets(data), [data]);
  const [params] = useSearchParams();
  const notice = useNotice();

  const initialProduct = activeProducts.some((p) => p.id === params.get('product')) ? params.get('product')! : '';
  const [form, setForm] = useState<PriceForm>({
    productId: initialProduct,
    storeId: '',
    date: today(),
    quantity: '',
    price: '',
    sale: false,
    note: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState<PriceRecord | null>(null);
  const lastSavedAt = useRef(0);
  const savedRef = useRef<HTMLElement>(null);

  // 登録後は完了表示が見えるようにする（スマホでは下の「登録する」ボタン付近にいるため）
  useEffect(() => {
    if (saved) savedRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [saved]);

  const set = <K extends keyof PriceForm>(key: K, value: PriceForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const { errors, value } = validatePriceForm(form);
  const shownErrors = submitted ? errors : {};

  const product = products.find((p) => p.id === form.productId);
  const qty = value.quantity;
  const yen = value.price;
  const unitPrice = product && qty > 0 && yen > 0 ? calcUnitPrice(yen, qty, product.unitAmount) : null;
  const diff = product ? calcDiff(unitPrice, product.targetUnitPrice) : null;

  const compareRow = useMemo(() => (product ? buildCompareRows([product], targets.records)[0] : null), [product, targets.records]);
  const currentCheapest = compareRow?.cheapest ?? null;
  const isNewLowest = unitPrice !== null && compareRow?.pastLowest != null && unitPrice < compareRow.pastLowest;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // 保存直後の連続クリックは無視する（1件だけ登録される）
    if (Date.now() - lastSavedAt.current < RESUBMIT_GUARD_MS) return;

    setSubmitted(true);
    if (hasErrors(errors)) {
      const labels: Record<string, string> = { productId: '商品', storeId: '店舗', date: '日付', quantity: '販売数量', price: '販売価格' };
      notice.show(`未入力または正しくない項目があります：${Object.keys(errors).map((k) => labels[k]).join('・')}`, 'error');
      // 最初のエラー欄へ移動する
      const order = ['productId', 'storeId', 'date', 'quantity', 'price'] as const;
      const ids = { productId: 'product', storeId: 'store', date: 'date', quantity: 'quantity', price: 'price' };
      const first = order.find((k) => errors[k]);
      if (first) document.getElementById(ids[first])?.focus();
      return;
    }
    const result = repository.addPriceRecord(value);
    if (!result.ok) {
      notice.show(result.error, 'error');
      return;
    }
    lastSavedAt.current = Date.now();
    setSaved(result.value);
    notice.show('価格を登録しました', 'success');
    // 同じお店で続けて登録しやすいよう、店舗と日付は残す
    setForm((f) => ({ ...f, productId: '', quantity: '', price: '', sale: false, note: '' }));
    setSubmitted(false);
  }

  function handleReset() {
    setForm({ productId: '', storeId: '', date: today(), quantity: '', price: '', sale: false, note: '' });
    setSubmitted(false);
    setSaved(null);
  }

  const unitLabel = product?.unit ?? '';
  const savedProduct = saved && products.find((p) => p.id === saved.productId);
  const savedUnitPrice = saved && savedProduct ? calcUnitPrice(saved.price, saved.quantity, savedProduct.unitAmount) : null;

  return (
    <>
      <PageHeader title="価格登録" description="お店で見た価格を入力すると、その場で単価と目安との差を確認できます。" />
      {notice.node}

      {saved && savedProduct && (
        <section ref={savedRef} className="card saved-card" data-testid="saved-summary" aria-label="登録した価格">
          <div className="saved-head">
            <Badge kind="good">✓ 登録しました</Badge>
            <span className="muted small">{saved.id}</span>
          </div>
          <div className="saved-body">
            <span className="list-title">{savedProduct.name}</span>
            <span className="muted small">
              {savedProduct.category}・{storeName(stores, saved.storeId)}・{formatYen(saved.quantity)}
              {savedProduct.unit} {formatYen(saved.price)}円
            </span>
            <Price value={savedUnitPrice} unit={savedProduct.unit} />
          </div>
          <div className="card-actions">
            <Link to={`/history?product=${saved.productId}&edit=${saved.id}`} className="button button-ghost">修正する</Link>
            <Link to={`/history?product=${saved.productId}`} className="button button-ghost">履歴を見る</Link>
            <Link to="/compare" className="button button-ghost">価格比較へ</Link>
          </div>
        </section>
      )}

      <form className="price-form" onSubmit={handleSubmit} noValidate>
        <div className="card form-card">
          <div className="field">
            <label htmlFor="product">商品 <span className="req">必須</span></label>
            <Combobox
              id="product"
              value={form.productId}
              options={productOptions}
              onChange={(v) => set('productId', v)}
              placeholder="商品名・IDで検索して選択"
              emptyText="該当する商品がありません"
              invalid={!!shownErrors.productId}
              describedBy={shownErrors.productId ? 'product-error' : undefined}
            />
            <FieldError id="product-error" message={shownErrors.productId} />
          </div>

          <div className="field">
            <label htmlFor="store">店舗 <span className="req">必須</span></label>
            <Combobox
              id="store"
              value={form.storeId}
              options={storeOptions}
              onChange={(v) => set('storeId', v)}
              placeholder="店舗名で検索して選択"
              emptyText="該当する店舗がありません"
              invalid={!!shownErrors.storeId}
              describedBy={shownErrors.storeId ? 'store-error' : undefined}
            />
            <FieldError id="store-error" message={shownErrors.storeId} />
          </div>

          <div className="field">
            <label htmlFor="date">日付 <span className="req">必須</span></label>
            <input id="date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} {...errorProps('date', shownErrors.date)} />
            <FieldError id="date-error" message={shownErrors.date} />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="quantity">販売数量 <span className="req">必須</span></label>
              <div className="input-affix">
                <input
                  id="quantity"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="例: 6"
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                  {...errorProps('quantity', shownErrors.quantity)}
                />
                <span className="affix">{unitLabel || '単位'}</span>
              </div>
              <FieldError id="quantity-error" message={shownErrors.quantity} />
            </div>
            <div className="field">
              <label htmlFor="price">販売価格 <span className="req">必須</span></label>
              <div className="input-affix">
                <input
                  id="price"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="例: 840"
                  value={form.price}
                  onChange={(e) => set('price', e.target.value)}
                  {...errorProps('price', shownErrors.price)}
                />
                <span className="affix">円</span>
              </div>
              <FieldError id="price-error" message={shownErrors.price} />
            </div>
          </div>

          <label className="toggle">
            <input type="checkbox" checked={form.sale} onChange={(e) => set('sale', e.target.checked)} />
            <span>セール価格（任意）</span>
          </label>

          <div className="field">
            <label htmlFor="note">備考（任意）</label>
            <textarea id="note" rows={2} placeholder="例: 2L×6本 / ポイント10倍" value={form.note} onChange={(e) => set('note', e.target.value)} />
          </div>
        </div>

        <section className="card result-card" aria-label="計算結果" aria-live="polite" data-testid="price-result">
          <h2>計算結果</h2>
          {!product ? (
            <p className="muted">商品を選ぶと、ここに単価と目安との比較が表示されます。</p>
          ) : (
            <>
              <div className="result-product">
                {product.name}
                {form.sale && <Badge kind="sale">セール</Badge>}
              </div>
              <div className="muted small">
                {product.category}／販売数量：{Number.isFinite(qty) ? `${formatYen(qty)}${product.unit}` : '—'}
                ／販売価格：{Number.isFinite(yen) ? `${formatYen(yen)}円` : '—'}
              </div>

              <div className="result-grid">
                <div className="result-main">
                  <span className="result-label">{product.unitAmount}{product.unit}あたり</span>
                  <Price value={unitPrice} size="lg" />
                </div>
                <div>
                  <span className="result-label">目安価格</span>
                  <Price value={product.targetUnitPrice} />
                </div>
              </div>

              {unitPrice !== null ? (
                <div className={`result-verdict ${diff !== null && diff <= 0 ? 'good' : diff === null ? 'neutral' : 'warn'}`} data-testid="result-verdict">
                  <DiffBadge diff={diff} hasTarget={product.targetUnitPrice !== null} />
                  {isNewLowest && <Badge kind="best">過去最安を更新</Badge>}
                </div>
              ) : (
                <p className="muted small">販売数量と販売価格を入力すると単価を計算します。</p>
              )}

              {currentCheapest && (
                <p className="muted small">
                  現在の最安：{formatYen(currentCheapest.unitPrice)}円/{product.unit}（{storeName(stores, currentCheapest.storeId)}）
                </p>
              )}
            </>
          )}
        </section>

        <div className="form-actions">
          <button type="button" className="button button-ghost" onClick={handleReset}>クリア</button>
          <button type="submit" className="button button-primary button-wide">登録する</button>
        </div>
      </form>
    </>
  );
}

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArchiveControls } from '../components/ArchiveControls';
import { FilterBar, FilterSummary, NoMatch, Pager, scrollToListTop, SearchField, StatusToggle } from '../components/ListFilter';
import { Badge, errorProps, FieldError, PageHeader, Price, useNotice } from '../components/ui';
import { repository, type Result } from '../data/repository';
import type { Product, ProductId } from '../data/types';
import { useAppData } from '../data/useAppData';
import { productMatches } from '../lib/search';
import { PAGE_SIZE } from '../lib/pagination';
import { useListFilter } from '../lib/useListFilter';
import { hasErrors, validateProductForm, type ProductForm } from '../lib/validation';

const UNIT_SUGGESTIONS = ['本', '個', '枚', '袋', '箱', 'パック', 'kg', 'g', 'L', 'ml', 'm', 'ロール'];

const emptyForm: ProductForm = { category: '', name: '', unitAmount: '1', unit: '', targetUnitPrice: '', maker: '', memo: '' };

function toForm(p: Product): ProductForm {
  return {
    category: p.category,
    name: p.name,
    unitAmount: String(p.unitAmount),
    unit: p.unit,
    targetUnitPrice: p.targetUnitPrice === null ? '' : String(p.targetUnitPrice),
    maker: p.maker ?? '',
    memo: p.memo ?? '',
  };
}

export function ProductsPage() {
  const { products, priceRecords } = useAppData();
  const notice = useNotice();
  /** null: フォームを閉じている / 'new': 新規登録 / 商品ID: 編集中 */
  const [editing, setEditing] = useState<'new' | ProductId | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const editingProduct = editing && editing !== 'new' ? products.find((p) => p.id === editing) ?? null : null;

  function open(target: 'new' | ProductId) {
    setEditing(target);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  /** 使用停止・再開・削除の結果を表示してフォームを閉じる */
  function finish(result: Result<Product>, message: (p: Product) => string) {
    if (!result.ok) return notice.show(result.error, 'error');
    setEditing(null);
    notice.show(message(result.value), 'success');
  }

  const categories = [...new Set(products.map((p) => p.category))];
  const filter = useListFilter(products, productMatches);
  // 商品ごとの価格記録の件数（商品ごとに全記録を数え直さないよう、記録が変わったときに1回だけ集計する）
  const recordCounts = useMemo(() => {
    const m = new Map<ProductId, number>();
    for (const r of priceRecords) m.set(r.productId, (m.get(r.productId) ?? 0) + 1);
    return m;
  }, [priceRecords]);
  const countOf = (id: ProductId) => recordCounts.get(id) ?? 0;

  const card = (p: Product) => (
    <li key={p.id} className={`card item-card${p.archived ? ' card-archived' : ''}`} data-testid={`product-${p.id}`}>
      <div className="item-card-head">
        <div>
          <span className="id-tag">{p.id}</span>
          <span className="muted small">{p.category}</span>
          {p.archived && <Badge kind="neutral">使用停止</Badge>}
        </div>
        <button type="button" className="button button-ghost button-sm" onClick={() => open(p.id)} aria-label={`${p.name}を編集`}>
          編集
        </button>
      </div>
      <div className="item-card-title">{p.name}</div>
      {(p.maker || p.memo) && <div className="muted small">{[p.maker, p.memo].filter(Boolean).join('・')}</div>}
      <dl className="kv">
        <div>
          <dt>比較単位</dt>
          <dd>{p.unitAmount}{p.unit}あたり</dd>
        </div>
        <div>
          <dt>目安単価</dt>
          <dd><Price value={p.targetUnitPrice} unit={p.unit} /></dd>
        </div>
      </dl>
      <Link to={`/history?product=${p.id}`} className="text-link small">価格履歴（{countOf(p.id)}件）</Link>
    </li>
  );

  return (
    <>
      <PageHeader
        title="商品"
        description="比較したい商品を登録します。単価は「基準数量・単位」あたりで比べます。"
        action={
          <button type="button" className="button button-primary" onClick={() => open('new')}>
            ＋ 商品登録
          </button>
        }
      />
      {notice.node}

      {(editing === 'new' || editingProduct) && (
        <div ref={formRef}>
          <ProductEditor
            key={editing ?? ''}
            product={editingProduct}
            categories={categories}
            onDone={(message) => {
              setEditing(null);
              notice.show(message, 'success');
            }}
            onCancel={() => setEditing(null)}
            onError={(message) => notice.show(message, 'error')}
          >
            {editingProduct && (
              <ArchiveControls
                kind="商品"
                name={editingProduct.name}
                archived={Boolean(editingProduct.archived)}
                usedCount={countOf(editingProduct.id)}
                onArchive={(a) =>
                  finish(repository.setProductArchived(editingProduct.id, a), (p) => `${p.id} ${p.name} を${a ? '使用停止にしました' : '再開しました'}`)
                }
                onDelete={() => finish(repository.deleteProduct(editingProduct.id), (p) => `${p.id} ${p.name} を削除しました`)}
              />
            )}
          </ProductEditor>
        </div>
      )}

      <FilterBar label="商品の検索" id="product-list-top">
        <SearchField id="product-search" label="商品を検索" placeholder="品目・カテゴリ・メーカーで検索" value={filter.query} onChange={filter.setQuery} />
        <div className="filter-row">
          <StatusToggle name="product-status" value={filter.status} onChange={filter.setStatus} />
          <FilterSummary shown={filter.shown.length} total={filter.total} filtered={filter.hasQuery} canClear={filter.changed} onClear={filter.clear} testId="product-count" page={filter.paged} />
        </div>
      </FilterBar>

      {filter.shown.length > 0 ? (
        <>
          <ul className="card-list" data-testid="product-list">
            {filter.paged.items.map(card)}
          </ul>
          <Pager
            page={filter.paged.page}
            pageCount={filter.paged.pageCount}
            testId="product-pager"
            onChange={(p) => {
              filter.setPage(p);
              scrollToListTop('product-list-top');
            }}
          />
        </>
      ) : filter.hasQuery ? (
        <NoMatch message="該当する商品がありません" onClear={filter.clear} testId="product-no-match" />
      ) : (
        <p className="list-empty-message" data-testid="product-empty">
          {filter.status === 'archived' ? '使用停止中の商品はありません。' : '商品がまだ登録されていません。「＋ 商品登録」から登録してください。'}
        </p>
      )}

      {filter.archivedExtra.length > 0 && (
        <details className="archived-section" data-testid="archived-products">
          <summary>使用停止中の商品（{filter.archivedExtra.length}件）</summary>
          <ul className="card-list">{filter.archivedExtra.slice(0, PAGE_SIZE).map(card)}</ul>
          {filter.archivedExtra.length > PAGE_SIZE && (
            <p className="muted small">
              ほか{filter.archivedExtra.length - PAGE_SIZE}件。すべて見るには
              <button type="button" className="link-button" onClick={() => filter.setStatus('archived')}>「使用停止」に切り替え</button>
              てください。
            </p>
          )}
        </details>
      )}
    </>
  );
}

function ProductEditor({
  product,
  categories,
  onDone,
  onCancel,
  onError,
  children,
}: {
  product: Product | null;
  categories: string[];
  onDone: (message: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
  children?: ReactNode;
}) {
  const [form, setForm] = useState<ProductForm>(product ? toForm(product) : emptyForm);
  const [submitted, setSubmitted] = useState(false);
  const saving = useRef(false);
  const { errors, value } = validateProductForm(form);
  const shown = submitted ? errors : {};
  const set = (key: keyof ProductForm, v: string) => setForm((f) => ({ ...f, [key]: v }));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    setSubmitted(true);
    if (hasErrors(errors)) return;
    saving.current = true;
    const result = product ? repository.updateProduct(product.id, value) : repository.addProduct(value);
    if (!result.ok) {
      saving.current = false;
      onError(result.error);
      return;
    }
    onDone(product ? `${result.value.id} ${result.value.name} を更新しました` : `${result.value.id} ${result.value.name} を登録しました`);
  }

  const text = (key: keyof ProductForm, label: string, opts: { required?: boolean; placeholder?: string; list?: string; inputMode?: 'decimal' } = {}) => {
    const id = `product-${key}`;
    const message = shown[key as keyof typeof shown];
    return (
      <div className="field">
        <label htmlFor={id}>
          {label} {opts.required ? <span className="req">必須</span> : <span className="opt">任意</span>}
        </label>
        <input
          id={id}
          type="text"
          autoComplete="off"
          value={form[key]}
          placeholder={opts.placeholder}
          list={opts.list}
          inputMode={opts.inputMode}
          onChange={(e) => set(key, e.target.value)}
          {...errorProps(id, message)}
        />
        <FieldError id={`${id}-error`} message={message} />
      </div>
    );
  };

  return (
    <form className="card form-card editor-card" onSubmit={handleSubmit} noValidate aria-label={product ? '商品の編集' : '商品登録'}>
      <h2>{product ? `商品の編集（${product.id}）` : '商品登録'}</h2>
      {!product && <p className="muted small">商品IDは自動で付きます。</p>}
      {text('category', 'カテゴリ', { required: true, placeholder: '例: 飲料', list: 'category-options' })}
      {text('name', '品目', { required: true, placeholder: '例: やさしい麦茶' })}
      <div className="field-row">
        {text('unitAmount', '基準数量', { required: true, placeholder: '例: 1', inputMode: 'decimal' })}
        {text('unit', '単位', { required: true, placeholder: '例: 本', list: 'unit-options' })}
      </div>
      {text('targetUnitPrice', '目安単価（円）', { placeholder: '例: 160（空欄可）', inputMode: 'decimal' })}
      {text('maker', 'メーカー', { placeholder: '例: サントリー' })}
      {text('memo', 'メモ', { placeholder: '例: 2L×6本' })}
      <datalist id="category-options">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="unit-options">
        {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
      </datalist>
      <div className="form-actions">
        <button type="button" className="button button-ghost" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="button button-primary button-wide">{product ? '更新する' : '登録する'}</button>
      </div>
      {product && <p className="muted small">商品ID（{product.id}）は変更できません。品目を変えても価格履歴はそのまま引き継がれます。</p>}
      {children}
    </form>
  );
}

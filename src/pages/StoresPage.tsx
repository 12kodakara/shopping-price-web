import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArchiveControls } from '../components/ArchiveControls';
import { FilterBar, FilterSummary, NoMatch, Pager, scrollToListTop, SearchField, StatusToggle } from '../components/ListFilter';
import { Badge, errorProps, FieldError, PageHeader, useNotice } from '../components/ui';
import { repository, type Result } from '../data/repository';
import type { Store, StoreId } from '../data/types';
import { useAppData } from '../data/useAppData';
import { storeMatches } from '../lib/search';
import { PAGE_SIZE } from '../lib/pagination';
import { useListFilter } from '../lib/useListFilter';
import { hasErrors, validateStoreForm, type StoreForm } from '../lib/validation';

export function StoresPage() {
  const { stores, priceRecords } = useAppData();
  const notice = useNotice();
  /** null: フォームを閉じている / 'new': 新規追加 / 店舗ID: 編集中 */
  const [editing, setEditing] = useState<'new' | StoreId | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const editingStore = editing && editing !== 'new' ? stores.find((s) => s.id === editing) ?? null : null;

  function open(target: 'new' | StoreId) {
    setEditing(target);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function finish(result: Result<Store>, message: (s: Store) => string) {
    if (!result.ok) return notice.show(result.error, 'error');
    setEditing(null);
    notice.show(message(result.value), 'success');
  }

  const types = [...new Set(stores.map((s) => s.type).filter((t): t is string => !!t))];
  // 店舗ごとの価格記録の件数（店舗ごとに全記録を数え直さないよう、記録が変わったときに1回だけ集計する）
  const recordCounts = useMemo(() => {
    const m = new Map<StoreId, number>();
    for (const r of priceRecords) m.set(r.storeId, (m.get(r.storeId) ?? 0) + 1);
    return m;
  }, [priceRecords]);
  const countOf = (id: StoreId) => recordCounts.get(id) ?? 0;
  const filter = useListFilter(stores, storeMatches);

  const row = (s: Store) => (
    <li key={s.id} className="list-row" data-testid={`store-${s.id}`}>
      <div className="list-main">
        <span className="list-title">
          {s.name} {s.archived && <Badge kind="neutral">使用停止</Badge>}
        </span>
        <span className="muted small">{[s.type, s.memo].filter(Boolean).join('・') || '—'}</span>
      </div>
      <div className="list-side list-side-row">
        <div className="list-side">
          <span className="muted small">記録 {countOf(s.id)}件</span>
          <span className="id-tag">{s.id}</span>
        </div>
        <button type="button" className="button button-ghost button-sm" onClick={() => open(s.id)} aria-label={`${s.name}を編集`}>
          編集
        </button>
      </div>
    </li>
  );

  return (
    <>
      <PageHeader
        title="店舗"
        description="価格を記録するお店を管理します。"
        action={
          <button type="button" className="button button-primary" onClick={() => open('new')}>
            ＋ 店舗追加
          </button>
        }
      />
      {notice.node}

      {(editing === 'new' || editingStore) && (
        <div ref={formRef}>
          <StoreEditor
            key={editing ?? ''}
            store={editingStore}
            types={types}
            onDone={(message) => {
              setEditing(null);
              notice.show(message, 'success');
            }}
            onCancel={() => setEditing(null)}
            onError={(message) => notice.show(message, 'error')}
          >
            {editingStore && (
              <ArchiveControls
                kind="店舗"
                name={editingStore.name}
                archived={Boolean(editingStore.archived)}
                usedCount={countOf(editingStore.id)}
                onArchive={(a) =>
                  finish(repository.setStoreArchived(editingStore.id, a), (x) => `${x.id} ${x.name} を${a ? '使用停止にしました' : '再開しました'}`)
                }
                onDelete={() => finish(repository.deleteStore(editingStore.id), (x) => `${x.id} ${x.name} を削除しました`)}
              />
            )}
          </StoreEditor>
        </div>
      )}

      <FilterBar label="店舗の検索" id="store-list-top">
        <SearchField id="store-search" label="店舗を検索" placeholder="店舗名・種類で検索" value={filter.query} onChange={filter.setQuery} />
        <div className="filter-row">
          <StatusToggle name="store-status" value={filter.status} onChange={filter.setStatus} />
          <FilterSummary shown={filter.shown.length} total={filter.total} filtered={filter.hasQuery} canClear={filter.changed} onClear={filter.clear} testId="store-count" page={filter.paged} />
        </div>
      </FilterBar>

      {filter.shown.length > 0 ? (
        <>
          <ul className="card list-card" data-testid="store-list">
            {filter.paged.items.map(row)}
          </ul>
          <Pager
            page={filter.paged.page}
            pageCount={filter.paged.pageCount}
            testId="store-pager"
            onChange={(p) => {
              filter.setPage(p);
              scrollToListTop('store-list-top');
            }}
          />
        </>
      ) : filter.hasQuery ? (
        <NoMatch message="該当する店舗がありません" onClear={filter.clear} testId="store-no-match" />
      ) : (
        <p className="list-empty-message" data-testid="store-empty">
          {filter.status === 'archived' ? '使用停止中の店舗はありません。' : '店舗がまだ登録されていません。「＋ 店舗追加」から追加してください。'}
        </p>
      )}

      {filter.archivedExtra.length > 0 && (
        <details className="archived-section" data-testid="archived-stores">
          <summary>使用停止中の店舗（{filter.archivedExtra.length}件）</summary>
          <ul className="card list-card">{filter.archivedExtra.slice(0, PAGE_SIZE).map(row)}</ul>
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

function StoreEditor({
  store,
  types,
  onDone,
  onCancel,
  onError,
  children,
}: {
  store: Store | null;
  types: string[];
  onDone: (message: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
  children?: ReactNode;
}) {
  const [form, setForm] = useState<StoreForm>({ name: store?.name ?? '', type: store?.type ?? '', memo: store?.memo ?? '' });
  const [submitted, setSubmitted] = useState(false);
  const saving = useRef(false);
  const { errors, value } = validateStoreForm(form);
  const shown = submitted ? errors : {};

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    setSubmitted(true);
    if (hasErrors(errors)) return;
    saving.current = true;
    const result = store ? repository.updateStore(store.id, value) : repository.addStore(value);
    if (!result.ok) {
      saving.current = false;
      onError(result.error);
      return;
    }
    onDone(store ? `${result.value.id} ${result.value.name} を更新しました` : `${result.value.id} ${result.value.name} を追加しました`);
  }

  return (
    <form className="card form-card editor-card" onSubmit={handleSubmit} noValidate aria-label={store ? '店舗の編集' : '店舗追加'}>
      <h2>{store ? `店舗の編集（${store.id}）` : '店舗追加'}</h2>
      {!store && <p className="muted small">店舗IDは自動で付きます。</p>}
      <div className="field">
        <label htmlFor="store-name">店舗名 <span className="req">必須</span></label>
        <input
          id="store-name"
          type="text"
          autoComplete="off"
          placeholder="例: 業務スーパー"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          {...errorProps('store-name', shown.name)}
        />
        <FieldError id="store-name-error" message={shown.name} />
      </div>
      <div className="field">
        <label htmlFor="store-type">種類 <span className="opt">任意</span></label>
        <input
          id="store-type"
          type="text"
          autoComplete="off"
          list="store-type-options"
          placeholder="例: スーパー"
          value={form.type}
          onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
        />
        <datalist id="store-type-options">
          {types.map((t) => <option key={t} value={t} />)}
        </datalist>
      </div>
      <div className="field">
        <label htmlFor="store-memo">メモ <span className="opt">任意</span></label>
        <input
          id="store-memo"
          type="text"
          autoComplete="off"
          value={form.memo}
          onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
        />
      </div>
      <div className="form-actions">
        <button type="button" className="button button-ghost" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="button button-primary button-wide">{store ? '更新する' : '追加する'}</button>
      </div>
      {store && <p className="muted small">店舗ID（{store.id}）は変更できません。店舗名を変えても価格履歴はそのまま引き継がれます。</p>}
      {children}
    </form>
  );
}

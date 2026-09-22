import { useEffect, useRef, useState, type FormEvent } from 'react';
import { repository } from '../data/repository';
import type { PriceRecord, Product, Store } from '../data/types';
import { calcUnitPrice, formatYen } from '../lib/price';
import { hasErrors, validatePriceForm, type PriceForm } from '../lib/validation';
import { errorProps, FieldError, Price } from './ui';

function toForm(r: PriceRecord): PriceForm {
  return {
    date: r.date,
    productId: r.productId,
    storeId: r.storeId,
    quantity: String(r.quantity),
    price: String(r.price),
    sale: Boolean(r.sale),
    note: r.note ?? '',
  };
}

/** 削除前の確認ダイアログ。削除対象が分かるよう内容を表示する */
export function confirmDeleteRecord(record: PriceRecord, product: Product | undefined, store: Store | undefined): boolean {
  const unit = product?.unit ?? '';
  const unitPrice = product ? calcUnitPrice(record.price, record.quantity, product.unitAmount) : null;
  return window.confirm(
    [
      '次の価格記録を削除します。',
      '',
      `日付：${record.date}`,
      `商品：${product?.name ?? record.productId}（${record.productId}）`,
      `店舗：${store?.name ?? record.storeId}`,
      `内容：${formatYen(record.quantity)}${unit} ${formatYen(record.price)}円${unitPrice !== null ? `（${formatYen(unitPrice)}円/${unit}）` : ''}`,
      `記録ID：${record.id}`,
      '',
      '削除すると元に戻せません。本当に削除しますか？',
    ].join('\n'),
  );
}

/** 価格記録の修正フォーム（価格履歴の一覧の中に表示する） */
export function PriceRecordEditor({
  record,
  products,
  stores,
  onSaved,
  onDeleted,
  onCancel,
  onError,
}: {
  record: PriceRecord;
  products: Product[];
  stores: Store[];
  onSaved: (updated: PriceRecord) => void;
  onDeleted: (deleted: PriceRecord) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<PriceForm>(() => toForm(record));
  const [submitted, setSubmitted] = useState(false);
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { errors, value } = validatePriceForm(form);

  // 開いたときにフォームが見える位置へ移動する（一覧の下の方の記録や、価格登録後の「修正する」から開いた場合）
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);
  const shown = submitted ? errors : {};
  const set = <K extends keyof PriceForm>(key: K, v: PriceForm[K]) => setForm((f) => ({ ...f, [key]: v }));

  // 使用停止の商品・店舗は選べないが、この記録で現在使っているものは残す
  const productOptions = products.filter((p) => !p.archived || p.id === record.productId);
  const storeOptions = stores.filter((s) => !s.archived || s.id === record.storeId);
  const product = products.find((p) => p.id === form.productId);
  const unitPrice = product && value.quantity > 0 && value.price > 0 ? calcUnitPrice(value.price, value.quantity, product.unitAmount) : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    setSubmitted(true);
    if (hasErrors(errors)) return;
    busy.current = true;
    const result = repository.updatePriceRecord(record.id, value);
    busy.current = false;
    if (!result.ok) onError(result.error);
    else onSaved(result.value);
  }

  function handleDelete() {
    if (busy.current) return;
    const ok = confirmDeleteRecord(record, products.find((p) => p.id === record.productId), stores.find((s) => s.id === record.storeId));
    if (!ok) return;
    busy.current = true;
    const result = repository.deletePriceRecord(record.id);
    busy.current = false;
    if (!result.ok) onError(result.error);
    else onDeleted(result.value);
  }

  return (
    <form ref={formRef} className="record-editor" onSubmit={handleSubmit} noValidate aria-label="価格記録の修正">
      <div className="record-editor-head">
        <strong>価格記録の修正</strong>
        <span className="id-tag">{record.id}</span>
      </div>

      <div className="field">
        <label htmlFor="rec-date">日付 <span className="req">必須</span></label>
        <input id="rec-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} {...errorProps('rec-date', shown.date)} />
        <FieldError id="rec-date-error" message={shown.date} />
      </div>
      <div className="field">
        <label htmlFor="rec-product">商品 <span className="req">必須</span></label>
        <select id="rec-product" value={form.productId} onChange={(e) => set('productId', e.target.value)} {...errorProps('rec-product', shown.productId)}>
          {productOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}（{p.id}）{p.archived ? '［使用停止］' : ''}</option>
          ))}
        </select>
        <FieldError id="rec-product-error" message={shown.productId} />
      </div>
      <div className="field">
        <label htmlFor="rec-store">店舗 <span className="req">必須</span></label>
        <select id="rec-store" value={form.storeId} onChange={(e) => set('storeId', e.target.value)} {...errorProps('rec-store', shown.storeId)}>
          {storeOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}{s.archived ? '［使用停止］' : ''}</option>
          ))}
        </select>
        <FieldError id="rec-store-error" message={shown.storeId} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="rec-quantity">販売数量 <span className="req">必須</span></label>
          <div className="input-affix">
            <input id="rec-quantity" type="text" inputMode="decimal" autoComplete="off" value={form.quantity}
              onChange={(e) => set('quantity', e.target.value)} {...errorProps('rec-quantity', shown.quantity)} />
            <span className="affix">{product?.unit ?? '単位'}</span>
          </div>
          <FieldError id="rec-quantity-error" message={shown.quantity} />
        </div>
        <div className="field">
          <label htmlFor="rec-price">販売価格 <span className="req">必須</span></label>
          <div className="input-affix">
            <input id="rec-price" type="text" inputMode="numeric" autoComplete="off" value={form.price}
              onChange={(e) => set('price', e.target.value)} {...errorProps('rec-price', shown.price)} />
            <span className="affix">円</span>
          </div>
          <FieldError id="rec-price-error" message={shown.price} />
        </div>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={form.sale} onChange={(e) => set('sale', e.target.checked)} />
        <span>セール価格</span>
      </label>
      <div className="field">
        <label htmlFor="rec-note">備考 <span className="opt">任意</span></label>
        <input id="rec-note" type="text" autoComplete="off" value={form.note} onChange={(e) => set('note', e.target.value)} />
      </div>

      <div className="record-editor-preview" data-testid="record-editor-unit-price">
        <span className="result-label">修正後の単価（{product ? `${product.unitAmount}${product.unit}あたり` : '—'}）</span>
        <Price value={unitPrice} unit={product?.unit} />
      </div>

      <div className="form-actions">
        <button type="button" className="button button-ghost" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="button button-primary button-wide">更新する</button>
      </div>
      <div className="record-editor-danger">
        <button type="button" className="button button-danger button-sm" onClick={handleDelete}>この記録を削除</button>
      </div>
    </form>
  );
}

import { isValidDate } from './date';

export { isValidDate };

// 入力チェック。画面のフォームと repository（保存直前の最終確認）の両方で使う。

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** 全角数字・全角ピリオド・カンマを許容して数値化。空欄は NaN */
export function parseNumber(text: string): number {
  const normalized = text
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，]/g, '')
    .trim();
  return normalized === '' ? Number.NaN : Number(normalized);
}

const clean = (s: string | undefined) => (s ?? '').trim();
const optional = (s: string | undefined) => clean(s) || undefined;

// ---------- 価格登録 ----------

export interface PriceInput {
  date: string;
  productId: string;
  storeId: string;
  quantity: number;
  price: number;
  sale: boolean;
  note?: string;
}

export type PriceField = 'productId' | 'storeId' | 'date' | 'quantity' | 'price';

export function priceInputErrors(input: PriceInput): FieldErrors<PriceField> {
  const e: FieldErrors<PriceField> = {};
  if (!input.productId) e.productId = '商品を選んでください';
  if (!input.storeId) e.storeId = '店舗を選んでください';
  if (!input.date) e.date = '日付を入力してください';
  else if (!isValidDate(input.date)) e.date = '日付が正しくありません';
  if (Number.isNaN(input.quantity)) e.quantity = '販売数量を入力してください';
  else if (!(input.quantity > 0)) e.quantity = '販売数量は0より大きい数を入力してください';
  if (Number.isNaN(input.price)) e.price = '販売価格を入力してください';
  else if (!(input.price > 0)) e.price = '販売価格は0より大きい数を入力してください';
  return e;
}

export interface PriceForm {
  date: string;
  productId: string;
  storeId: string;
  quantity: string;
  price: string;
  sale: boolean;
  note: string;
}

export function validatePriceForm(form: PriceForm): { errors: FieldErrors<PriceField>; value: PriceInput } {
  const value: PriceInput = {
    date: clean(form.date),
    productId: form.productId,
    storeId: form.storeId,
    quantity: parseNumber(form.quantity),
    price: parseNumber(form.price),
    sale: form.sale,
    note: optional(form.note),
  };
  return { errors: priceInputErrors(value), value };
}

// ---------- 商品登録 ----------

export interface ProductInput {
  category: string;
  name: string;
  unitAmount: number;
  unit: string;
  targetUnitPrice: number | null;
  maker?: string;
  memo?: string;
}

export type ProductField = 'category' | 'name' | 'unitAmount' | 'unit' | 'targetUnitPrice';

export function productInputErrors(input: ProductInput): FieldErrors<ProductField> {
  const e: FieldErrors<ProductField> = {};
  if (!clean(input.category)) e.category = 'カテゴリを入力してください';
  if (!clean(input.name)) e.name = '品目を入力してください';
  if (Number.isNaN(input.unitAmount)) e.unitAmount = '基準数量を入力してください';
  else if (!(input.unitAmount > 0)) e.unitAmount = '基準数量は0より大きい数を入力してください';
  if (!clean(input.unit)) e.unit = '単位を入力してください';
  if (input.targetUnitPrice !== null && !(input.targetUnitPrice >= 0)) {
    e.targetUnitPrice = '目安単価は空欄または0以上の数を入力してください';
  }
  return e;
}

export interface ProductForm {
  category: string;
  name: string;
  unitAmount: string;
  unit: string;
  targetUnitPrice: string;
  maker: string;
  memo: string;
}

export function validateProductForm(form: ProductForm): { errors: FieldErrors<ProductField>; value: ProductInput } {
  const value: ProductInput = {
    category: clean(form.category),
    name: clean(form.name),
    unitAmount: parseNumber(form.unitAmount),
    unit: clean(form.unit),
    targetUnitPrice: clean(form.targetUnitPrice) === '' ? null : parseNumber(form.targetUnitPrice),
    maker: optional(form.maker),
    memo: optional(form.memo),
  };
  return { errors: productInputErrors(value), value };
}

// ---------- 店舗登録 ----------

export interface StoreInput {
  name: string;
  type?: string;
  memo?: string;
}

export type StoreField = 'name';

export function storeInputErrors(input: StoreInput): FieldErrors<StoreField> {
  return clean(input.name) ? {} : { name: '店舗名を入力してください' };
}

export interface StoreForm {
  name: string;
  type: string;
  memo: string;
}

export function validateStoreForm(form: StoreForm): { errors: FieldErrors<StoreField>; value: StoreInput } {
  const value: StoreInput = { name: clean(form.name), type: optional(form.type), memo: optional(form.memo) };
  return { errors: storeInputErrors(value), value };
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

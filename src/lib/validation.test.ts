import { describe, expect, it } from 'vitest';
import { isValidDate, parseNumber, validatePriceForm, validateProductForm, validateStoreForm } from './validation';

describe('parseNumber', () => {
  it('全角数字・カンマを受け付ける', () => {
    expect(parseNumber('８４０')).toBe(840);
    expect(parseNumber('1,698')).toBe(1698);
    expect(parseNumber(' 2.5 ')).toBe(2.5);
  });
  it('空欄や文字は NaN', () => {
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('abc')).toBeNaN();
  });
});

describe('isValidDate', () => {
  it('実在する日付だけ有効', () => {
    expect(isValidDate('2026-09-22')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026/09/22')).toBe(false);
  });
});

describe('価格登録フォーム', () => {
  const ok = { date: '2026-09-22', productId: 'P005', storeId: 'S009', quantity: '6', price: '840', sale: false, note: '' };

  it('正しい入力はエラーなし', () => {
    const r = validatePriceForm(ok);
    expect(r.errors).toEqual({});
    expect(r.value).toMatchObject({ quantity: 6, price: 840, note: undefined });
  });

  it('必須項目と数値の範囲をチェックする', () => {
    const r = validatePriceForm({ ...ok, productId: '', storeId: '', date: '', quantity: '0', price: '-5' });
    expect(Object.keys(r.errors).sort()).toEqual(['date', 'price', 'productId', 'quantity', 'storeId']);
    expect(validatePriceForm({ ...ok, price: '0' }).errors.price).toBeDefined();
    expect(validatePriceForm({ ...ok, quantity: '' }).errors.quantity).toBe('販売数量を入力してください');
  });
});

describe('商品登録フォーム', () => {
  const ok = { category: '飲料', name: '天然水', unitAmount: '1', unit: 'L', targetUnitPrice: '', maker: '', memo: '' };

  it('目安単価は空欄なら null', () => {
    expect(validateProductForm(ok)).toMatchObject({ errors: {}, value: { targetUnitPrice: null, maker: undefined } });
    expect(validateProductForm({ ...ok, targetUnitPrice: '0' }).errors).toEqual({});
  });

  it('必須項目と数値の範囲をチェックする', () => {
    const r = validateProductForm({ ...ok, category: ' ', name: '', unitAmount: '0', unit: '', targetUnitPrice: '-1' });
    expect(Object.keys(r.errors).sort()).toEqual(['category', 'name', 'targetUnitPrice', 'unit', 'unitAmount']);
    expect(validateProductForm({ ...ok, targetUnitPrice: 'abc' }).errors.targetUnitPrice).toBeDefined();
  });
});

describe('店舗登録フォーム', () => {
  it('店舗名は必須', () => {
    expect(validateStoreForm({ name: '', type: '', memo: '' }).errors.name).toBeDefined();
    expect(validateStoreForm({ name: ' 業務スーパー ', type: '', memo: '' })).toMatchObject({ errors: {}, value: { name: '業務スーパー' } });
  });
});

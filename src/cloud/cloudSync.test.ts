import { describe, expect, it } from 'vitest';
import type { DataCounts } from './cloudRows';
import { backupRequiredBeforeDownload, planDownload, planUpload, situationOf } from './cloudSync';

const empty: DataCounts = { products: 0, stores: 0, priceRecords: 0, shoppingList: 0, purchased: 0 };
const some: DataCounts = { products: 5, stores: 9, priceRecords: 5, shoppingList: 2, purchased: 1 };
const other: DataCounts = { products: 12, stores: 3, priceRecords: 40, shoppingList: 0, purchased: 0 };

describe('どちらにデータがあるかの判定', () => {
  it('4つの状態を見分けられる', () => {
    expect(situationOf(empty, empty)).toBe('both-empty');
    expect(situationOf(some, empty)).toBe('local-only');
    expect(situationOf(empty, some)).toBe('cloud-only');
    expect(situationOf(some, other)).toBe('both');
  });

  it('買い物リストだけでも「データあり」として扱う', () => {
    const listOnly: DataCounts = { ...empty, shoppingList: 1 };
    expect(situationOf(listOnly, empty)).toBe('local-only');
  });
});

describe('この端末のデータをクラウドへ保存（アップロード）', () => {
  it('クラウドが空なら、確認なしで実行できる', () => {
    const plan = planUpload(some, empty);
    expect(plan).toMatchObject({ situation: 'local-only', allowed: true, needsConfirm: false });
  });

  it('両方にデータがあり内容が違うときは、確認しないと実行できない', () => {
    const plan = planUpload(some, other);
    expect(plan.allowed).toBe(true);
    expect(plan.needsConfirm).toBe(true);
    expect(plan.message).toContain('置き換わります');
  });

  it('両方にデータがあっても内容が同じなら、確認は不要', () => {
    expect(planUpload(some, some, true)).toMatchObject({ allowed: true, needsConfirm: false });
  });

  it('★端末が空のときは実行できない（クラウドのデータを空にしない）', () => {
    const plan = planUpload(empty, some);
    expect(plan.allowed).toBe(false);
    expect(plan.message).toContain('消えてしまいます');
  });

  it('両方とも空なら、送るものがないので実行できない', () => {
    expect(planUpload(empty, empty).allowed).toBe(false);
  });
});

describe('クラウドのデータをこの端末へ取得（ダウンロード）', () => {
  it('この端末が空なら、確認なしで実行できる', () => {
    expect(planDownload(empty, some)).toMatchObject({ situation: 'cloud-only', allowed: true, needsConfirm: false });
  });

  it('両方にデータがあり内容が違うときは、確認しないと実行できない', () => {
    const plan = planDownload(some, other);
    expect(plan.allowed).toBe(true);
    expect(plan.needsConfirm).toBe(true);
    expect(plan.message).toContain('置き換わります');
  });

  it('両方にデータがあっても内容が同じなら、確認は不要', () => {
    expect(planDownload(some, some, true)).toMatchObject({ allowed: true, needsConfirm: false });
  });

  it('★クラウドが空のときは実行できない（この端末のデータを空にしない）', () => {
    const plan = planDownload(some, empty);
    expect(plan.allowed).toBe(false);
    expect(plan.message).toContain('消えてしまいます');
  });

  it('両方とも空なら、取得するものがないので実行できない', () => {
    expect(planDownload(empty, empty).allowed).toBe(false);
  });
});

describe('取得前のバックアップ', () => {
  it('この端末にデータがあるときは必須', () => {
    expect(backupRequiredBeforeDownload(some)).toBe(true);
  });

  it('この端末が空のときは不要', () => {
    expect(backupRequiredBeforeDownload(empty)).toBe(false);
  });
});

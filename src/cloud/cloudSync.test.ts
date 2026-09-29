import { describe, expect, it } from 'vitest';
import type { DataCounts } from './cloudRows';
import { backupRequiredBeforeDownload, planDownload, planUpload, runBlockedReason, situationOf } from './cloudSync';

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

describe('取得前のファイルへのバックアップ（勧めるだけで、取得の条件にはしない）', () => {
  it('この端末にデータがあるときは勧める', () => {
    expect(backupRequiredBeforeDownload(some)).toBe(true);
  });

  it('この端末が空のときは不要', () => {
    expect(backupRequiredBeforeDownload(empty)).toBe(false);
  });
});

// 第13回の不具合：実行ボタンが押せないのに理由が出ず、「押しても何も起きない」状態になっていた
describe('実行ボタンを押せない理由（第13回）', () => {
  const label = 'この端末の内容が置き換わることを理解しました';
  // 実際に不具合が起きた状態：買い物リストだけが違う
  const local: DataCounts = { products: 5, stores: 9, priceRecords: 10, shoppingList: 0, purchased: 0 };
  const cloud: DataCounts = { products: 5, stores: 9, priceRecords: 10, shoppingList: 4, purchased: 0 };

  it('★確認のチェックを入れれば、ファイルへのバックアップなしで押せる', () => {
    const plan = planDownload(local, cloud);
    expect(plan).toMatchObject({ situation: 'both', allowed: true, needsConfirm: true });
    expect(runBlockedReason(plan, true, label)).toBeNull();
  });

  it('チェックを入れていないときは、何をすれば押せるかを示す', () => {
    const reason = runBlockedReason(planDownload(local, cloud), false, label);
    expect(reason).toContain(label);
    expect(reason).toContain('チェックを入れてください');
  });

  it('実行してはいけない状況では、押せない理由を返す', () => {
    expect(runBlockedReason(planDownload(some, empty), true, label)).toContain('実行できません');
    expect(runBlockedReason(null, true, label)).toContain('実行できません');
  });

  it('確認が不要な状況では、そのまま押せる', () => {
    expect(runBlockedReason(planDownload(empty, some), false, label)).toBeNull();
  });
});

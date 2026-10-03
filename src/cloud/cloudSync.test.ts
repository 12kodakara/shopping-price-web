import { describe, expect, it } from 'vitest';
import type { DataCounts } from './cloudRows';
import {
  backupRequiredBeforeDownload,
  describeSyncDifference,
  hasSameCounts,
  planDownload,
  planUpload,
  runBlockedReason,
  situationOf,
} from './cloudSync';

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

// 第15回：件数が同じでも内容が違うことがある
describe('件数と内容の違いの説明', () => {
  it('クラウドを確認していないときは、その旨を返す', () => {
    expect(describeSyncDifference(some, null, 'unknown')).toMatchObject({ kind: 'unknown', sameCounts: false });
  });

  it('件数が同じでも、照合していなければ「同じとは限らない」と伝える', () => {
    const d = describeSyncDifference(some, { ...some }, 'unknown');
    expect(d.sameCounts).toBe(true);
    expect(d.text).toContain('件数は一致しています');
    expect(d.text).toContain('同じとは限りません');
    expect(d.suggestVerify).toBe(true);
  });

  it('★件数は同じだが内容が違うときは、そう言い分ける', () => {
    const d = describeSyncDifference(some, { ...some }, 'different');
    expect(d.sameCounts).toBe(true);
    expect(d.kind).toBe('different');
    expect(d.text).toContain('件数は一致していますが、内容が異なります');
  });

  it('件数も内容も違うときは、その旨を伝える', () => {
    const d = describeSyncDifference(some, other, 'different');
    expect(d.sameCounts).toBe(false);
    expect(d.text).toContain('件数も内容も異なります');
  });

  it('照合して同じだったときは、同期が取れていると伝える', () => {
    const d = describeSyncDifference(some, { ...some }, 'same');
    expect(d.kind).toBe('same');
    expect(d.text).toContain('件数も内容も一致しています');
    expect(d.suggestVerify).toBe(false);
  });

  it('件数が違えば、照合していなくても違いとして扱う', () => {
    const d = describeSyncDifference(some, other, 'unknown');
    expect(d.sameCounts).toBe(false);
    expect(d.kind).toBe('different');
    expect(d.text).toContain('件数が異なります');
  });

  it('購入済みの数だけが違っても、件数一致の判定は変わらない（買い物リストの件数で見る）', () => {
    expect(hasSameCounts(some, { ...some, purchased: some.purchased + 1 })).toBe(true);
    expect(hasSameCounts(some, { ...some, shoppingList: some.shoppingList + 1 })).toBe(false);
  });
});

// 第18回: 保存が途中で止まったクラウドを取り込ませない
describe('保存が完了していないクラウド（完了印がない）', () => {
  it('★クラウドにデータがあるのに完了印がないときは取得できない', () => {
    const plan = planDownload(empty, some, false, true);
    expect(plan.allowed).toBe(false);
    expect(plan.message).toContain('保存が完了していない可能性');
    expect(plan.message).toContain('もう一度');
  });

  it('★両方にデータがある場合も、完了印がなければ取得できない', () => {
    expect(planDownload(some, other, false, true).allowed).toBe(false);
  });

  it('完了印があれば、これまでどおり取得できる', () => {
    expect(planDownload(empty, some, false, false).allowed).toBe(true);
    expect(planDownload(some, other, false, false)).toMatchObject({ allowed: true, needsConfirm: true });
  });

  it('クラウドが空なら、完了印の有無に関係なく「取るものがない」の案内になる', () => {
    expect(planDownload(some, empty, false, true).message).toContain('クラウドにデータがありません');
  });

  it('保存（端末→クラウド）は完了印の影響を受けない（上書きして直せるため）', () => {
    expect(planUpload(some, other).allowed).toBe(true);
  });
});

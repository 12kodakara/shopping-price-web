// 同期の「やってよいかどうか」の判断。通信もデータ変更もしない純粋な関数。
//
// いちばん大事な決まりごと（第12回）
//   ・クラウドが空だからといって、端末のデータを空にしない
//   ・端末が空だからといって、クラウドのデータを空にしない
//   ・両方にデータがあるときは、確認なしに上書きしない
// 自動マージ（内容の合成）は行わない。安全側に倒して、必ず利用者に選んでもらう。

import { isEmptyCounts, type DataCounts } from './cloudRows';

export type SyncSituation =
  /** 両方ともデータなし */
  | 'both-empty'
  /** この端末にだけデータがある */
  | 'local-only'
  /** クラウドにだけデータがある */
  | 'cloud-only'
  /** 両方にデータがある */
  | 'both';

export interface SyncPlan {
  situation: SyncSituation;
  /** 実行してよいか */
  allowed: boolean;
  /** 実行前に「上書きします」の確認が必要か */
  needsConfirm: boolean;
  /** 画面に出す説明 */
  message: string;
}

export function situationOf(local: DataCounts, cloud: DataCounts): SyncSituation {
  const localEmpty = isEmptyCounts(local);
  const cloudEmpty = isEmptyCounts(cloud);
  if (localEmpty && cloudEmpty) return 'both-empty';
  if (cloudEmpty) return 'local-only';
  if (localEmpty) return 'cloud-only';
  return 'both';
}

/**
 * この端末のデータをクラウドへ保存してよいか。
 * `identical` は、両方にデータがあって内容も同じだと分かっている場合に true。
 */
export function planUpload(local: DataCounts, cloud: DataCounts, identical = false): SyncPlan {
  const situation = situationOf(local, cloud);
  switch (situation) {
    case 'both-empty':
      return { situation, allowed: false, needsConfirm: false, message: 'この端末にもクラウドにもデータがありません。保存するものがありません。' };
    case 'cloud-only':
      // 端末が空。ここで実行するとクラウドのデータが消えるため、実行させない
      return {
        situation,
        allowed: false,
        needsConfirm: false,
        message:
          'この端末にデータがありません。いま保存すると、クラウドにあるデータが消えてしまいます。' +
          '先に「クラウドのデータをこの端末へ取得」をお使いください。',
      };
    case 'local-only':
      return { situation, allowed: true, needsConfirm: false, message: 'クラウドは空です。この端末のデータをそのまま保存します。' };
    case 'both':
      return identical
        ? { situation, allowed: true, needsConfirm: false, message: 'クラウドの内容はこの端末と同じです。保存しなおしても変わりません。' }
        : {
            situation,
            allowed: true,
            needsConfirm: true,
            message: 'クラウドに別の内容のデータがあります。実行すると、クラウド側はこの端末の内容に置き換わります。',
          };
  }
}

/**
 * クラウドのデータをこの端末へ取得してよいか。
 * `identical` は、両方にデータがあって内容も同じだと分かっている場合に true。
 */
export function planDownload(local: DataCounts, cloud: DataCounts, identical = false, cloudIncomplete = false): SyncPlan {
  const situation = situationOf(local, cloud);

  // 第18回: クラウドにデータはあるのに「保存の完了印」がない＝保存が途中で止まった可能性がある。
  // そのまま取り込むと、欠けた内容でこの端末が置き換わってしまうので実行させない。
  if (cloudIncomplete && situation !== 'both-empty' && situation !== 'local-only') {
    return {
      situation,
      allowed: false,
      needsConfirm: false,
      message:
        'クラウドのデータは保存が完了していない可能性があります（保存の途中で通信が切れたときに起こります）。' +
        '取り込むと内容が欠けたままになるため、実行できません。保存した端末で、もう一度「この端末のデータをクラウドへ保存」を行ってください。',
    };
  }
  switch (situation) {
    case 'both-empty':
      return { situation, allowed: false, needsConfirm: false, message: 'クラウドにデータがありません。取得するものがありません。' };
    case 'local-only':
      // クラウドが空。ここで実行すると端末のデータが消えるため、実行させない
      return {
        situation,
        allowed: false,
        needsConfirm: false,
        message:
          'クラウドにデータがありません。いま取得すると、この端末のデータが消えてしまいます。' +
          '先に「この端末のデータをクラウドへ保存」をお使いください。',
      };
    case 'cloud-only':
      return { situation, allowed: true, needsConfirm: false, message: 'この端末は空です。クラウドのデータを取り込みます。' };
    case 'both':
      return identical
        ? { situation, allowed: true, needsConfirm: false, message: 'クラウドの内容はこの端末と同じです。取得しても変わりません。' }
        : {
            situation,
            allowed: true,
            needsConfirm: true,
            message: 'この端末にも別の内容のデータがあります。実行すると、この端末のデータはクラウドの内容に置き換わります。',
          };
  }
}

/**
 * 取得の前に、ファイルへのバックアップを勧めるか（端末にデータがあるとき）。
 *
 * 第13回：これは「勧める」だけで、取得の条件にはしない。
 * 以前は保存するまで実行ボタンが押せず、しかも押せない理由が画面に出なかったため、
 * 「押しても何も起きない」状態になっていた。ファイル保存はブラウザ（スマホのホーム画面アプリなど）
 * によってはうまく動かないこともある。端末内の退避（復元前バックアップ）は repository.restore が必ず行い、
 * 退避できなければ取り込みそのものを中止する。
 */
export function backupRequiredBeforeDownload(local: DataCounts): boolean {
  return !isEmptyCounts(local);
}

/**
 * 実行ボタンを押せない理由。押せるときは null。
 * ボタンを押せないときは必ず理由を画面に出し、「押しても反応しない」状態を作らない。
 */
export function runBlockedReason(plan: SyncPlan | null, confirmed: boolean, confirmLabel: string): string | null {
  if (!plan) return 'クラウドの状態を確認できていないため、実行できません。「やめる」を押してから、もう一度お試しください。';
  if (!plan.allowed) return 'この操作はいま実行できません（理由は上の説明をご覧ください）。';
  if (plan.needsConfirm && !confirmed) return `実行するには、上の「${confirmLabel}」にチェックを入れてください。`;
  return null;
}

// ---------- 件数と内容の違い（第15回） ----------

/**
 * クラウドとこの端末の内容が同じかどうかの確認状況。
 *
 * 件数は「クラウドの状態を確認」で軽く取れるが、**件数が同じでも内容が同じとは限らない**
 * （例：同じ5件でも、片方だけ商品名を直している）。内容まで確かめるにはデータを取り寄せて
 * 見比べる必要があるため、確認していない状態（unknown）を区別して扱う。
 */
export type ContentMatch = 'unknown' | 'same' | 'different';

export interface SyncDifference {
  /** 件数が全部そろっているか */
  sameCounts: boolean;
  /** 画面に出す説明 */
  text: string;
  /** 表示の強さ（same: 落ち着いた表示 / different: 注意を促す表示 / unknown: 補足） */
  kind: 'same' | 'different' | 'unknown';
  /** 「内容まで照合する」を勧めるか */
  suggestVerify: boolean;
}

/** 件数がすべて同じか（買い物リストの購入済みは件数比較に含めない） */
export function hasSameCounts(local: DataCounts, cloud: DataCounts): boolean {
  return (
    local.products === cloud.products &&
    local.stores === cloud.stores &&
    local.priceRecords === cloud.priceRecords &&
    local.shoppingList === cloud.shoppingList
  );
}

/**
 * 件数と内容の違いを、利用者に伝わる言葉にする。
 * 「件数は一致していますが、内容が異なります」を言い分けられるようにするのが目的。
 */
export function describeSyncDifference(local: DataCounts, cloud: DataCounts | null, match: ContentMatch): SyncDifference {
  if (cloud === null) {
    return { sameCounts: false, kind: 'unknown', text: 'クラウドの状態はまだ確認していません。', suggestVerify: false };
  }
  const sameCounts = hasSameCounts(local, cloud);

  if (match === 'same') {
    return { sameCounts, kind: 'same', text: '件数も内容も一致しています。同期は取れています。', suggestVerify: false };
  }
  if (match === 'different') {
    return {
      sameCounts,
      kind: 'different',
      text: sameCounts
        ? '件数は一致していますが、内容が異なります。どちらの内容を残すか選んでください。'
        : '件数も内容も異なります。どちらの内容を残すか選んでください。',
      suggestVerify: false,
    };
  }
  // まだ内容を見比べていない
  return sameCounts
    ? {
        sameCounts,
        kind: 'unknown',
        text: '件数は一致しています。ただし件数が同じでも中身が同じとは限りません（「内容まで照合する」で確かめられます）。',
        suggestVerify: true,
      }
    : { sameCounts, kind: 'different', text: '件数が異なります。', suggestVerify: true };
}

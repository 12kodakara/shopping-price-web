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
export function planDownload(local: DataCounts, cloud: DataCounts, identical = false): SyncPlan {
  const situation = situationOf(local, cloud);
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

/** 取得を実行する前に、端末のデータの退避（バックアップ）が必要か */
export function backupRequiredBeforeDownload(local: DataCounts): boolean {
  return !isEmptyCounts(local);
}

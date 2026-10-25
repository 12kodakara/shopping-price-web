// JANコードで商品を探す（画面から呼ぶ側）。
//
// 実際の問い合わせは Supabase の Edge Function（supabase/functions/jan-lookup）が行う。
// Yahoo! の Client ID はそちらにだけ置いてあり、このファイル（ブラウザ）には含まれない。
//
// ・ログインしているときだけ使える（Edge Function 側もログインを必須にしている）
// ・見つからなくても、これまでどおり手で入力して登録できる
// ・取得した画像は確認用に表示するだけで、保存はしない

import { normalizeJan, type JanCandidate } from '../../supabase/functions/jan-lookup/lib';
import { getSupabase } from './supabaseClient';

export type { JanCandidate };
export { normalizeJan };

export type JanLookupResult = { ok: true; candidates: JanCandidate[] } | { ok: false; error: string };

/** Edge Function の名前（デプロイ時も同じ名前にする） */
export const JAN_FUNCTION = 'jan-lookup';

/**
 * JANコードで商品の候補を取得する。
 * 失敗しても例外は投げず、画面に出せる日本語の理由を返す（手入力は続けられる）。
 */
export async function lookupJan(jan: string): Promise<JanLookupResult> {
  const code = normalizeJan(jan);
  if (!code) return { ok: false, error: 'JANコードは8桁または13桁の数字で入力してください' };

  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: 'この端末ではJANコード検索を使えません（クラウド未設定）' };

  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return { ok: false, error: 'JANコード検索にはログインが必要です。データ管理からログインしてください' };

  try {
    const { data, error } = await supabase.functions.invoke(JAN_FUNCTION, { body: { jan: code } });
    if (error) return { ok: false, error: describeFunctionError(error) };
    const candidates = (data as { candidates?: unknown } | null)?.candidates;
    if (!Array.isArray(candidates)) return { ok: false, error: '検索結果を読み取れませんでした' };
    return { ok: true, candidates: candidates as JanCandidate[] };
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    return { ok: false, error: /fetch|network/i.test(message) ? '通信できませんでした。電波の良い場所でお試しください' : '検索に失敗しました' };
  }
}

/** Edge Function から返った失敗を、画面に出せる短い日本語にする */
export function describeFunctionError(error: { message?: string; context?: { status?: number } }): string {
  const status = error.context?.status;
  if (status === 401 || status === 403) return 'JANコード検索にはログインが必要です。ログインし直してからお試しください';
  if (status === 429) return '短い時間に検索しすぎています。少し待ってからお試しください';
  if (status === 503) return 'JANコード検索の準備ができていません（管理者の設定待ち）';
  if (status === 504) return '検索に時間がかかっています。もう一度お試しください';
  return '検索に失敗しました。しばらくしてからお試しください';
}

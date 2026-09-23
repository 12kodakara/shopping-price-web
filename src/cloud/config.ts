// クラウド（Supabase）の接続設定。
//
// 値はビルド時の環境変数から読む。設定がなければ「未設定」となり、アプリはこれまでどおり
// localStorage だけで動く（クラウド関連の処理は一切行わない）。
//
//   VITE_SUPABASE_URL              … プロジェクトのURL（例: https://xxxx.supabase.co）
//   VITE_SUPABASE_PUBLISHABLE_KEY  … 公開用キー（新しい名前。sb_publishable_... ）
//   VITE_SUPABASE_ANON_KEY         … 公開用キー（従来の名前。どちらか一方でよい）
//
// ここで扱うのは「公開してよい値」だけ。VITE_ で始まる値はビルド結果のJavaScriptに
// 埋め込まれ、誰でも読める。管理用キー（service_role）やデータベースのパスワードは
// 絶対に扱わない（下の looksLikeSecretKey で誤設定を検出して止める）。

export interface CloudConfig {
  url: string;
  /** 公開用キー（anon / publishable） */
  key: string;
}

/** 管理用の秘密キーらしいか（誤って設定されたら使わない） */
export function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  // JWT形式（xxx.yyy.zzz）なら、真ん中の部分に role が入っている
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role && payload.role !== 'anon') return true;
    } catch {
      // 読めない場合は判定しない
    }
  }
  return false;
}

/** URLとして妥当か（http はローカル開発・テスト用の場合だけ許す） */
function isUsableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 接続設定を読む。設定がない・形式が正しくない場合は null（＝クラウド未設定）。
 * 問題がある場合だけ開発者向けにコンソールへ出す（利用者への警告ダイアログは出さない）。
 */
export function readCloudConfig(env: Record<string, string | boolean | undefined> = import.meta.env): CloudConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim();
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url && !key) return null; // 未設定（通常の状態）

  if (!url || !key) {
    console.warn('[cloud] URL と公開用キーの両方を設定してください。クラウド同期は無効のままにします。');
    return null;
  }
  if (!isUsableUrl(url)) {
    console.warn('[cloud] VITE_SUPABASE_URL の形式が正しくありません。クラウド同期は無効のままにします。');
    return null;
  }
  if (looksLikeSecretKey(key)) {
    console.error('[cloud] 公開してはいけないキー（管理用キー）が設定されています。クラウド同期を無効にしました。公開用キー（anon / publishable）を設定してください。');
    return null;
  }
  return { url, key };
}

export const cloudConfig: CloudConfig | null = readCloudConfig();
export const isCloudConfigured = cloudConfig !== null;

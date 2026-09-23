import type { SupabaseClient } from '@supabase/supabase-js';
import { cloudConfig } from './config';

// Supabase クライアント。設定がなければ作らない（null）。
// ここを通らない限り、アプリは外部へ一切通信しない。
//
// ライブラリ本体は「設定があるときだけ」読み込む（動的 import）。
// 未設定の状態（現在の公開版）では読み込まれないので、アプリの読み込みが重くならない。

let client: SupabaseClient | null = null;

/** 設定があればクライアントを返す。未設定なら null */
export async function getSupabase(): Promise<SupabaseClient | null> {
  if (!cloudConfig) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(cloudConfig.url, cloudConfig.key, {
      auth: {
        // ログイン状態の保存・更新はライブラリに任せる（自前でトークンを保存しない）
        persistSession: true,
        autoRefreshToken: true,
        // メールのリンクから戻ってきたときの受け取りは、アプリ側で明示的に行う（cloud/auth.ts）
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }
  return client;
}

/** テスト用: 作成済みのクライアントを捨てる */
export function resetSupabaseForTest() {
  client = null;
}

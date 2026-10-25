// JANコードから商品の候補を探す（Supabase Edge Function / Deno）。
//
// なぜサーバー側に置くか：
//   このアプリは GitHub Pages で配信する静的サイトなので、ブラウザに Client ID を置くと
//   誰でも見られてしまう。Client ID はここ（Supabase のシークレット）だけに置き、
//   ブラウザへは商品名・ブランド・画像URLだけを返す。
//
// 使い方（デプロイ後）:
//   POST /functions/v1/jan-lookup   { "jan": "4901234567894" }
//   → { "candidates": [ { name, brand, imageUrl, jan } ] }
//
// 注意:
//   ・ログイン済みの利用者だけが呼べる。
//     Supabase の「Verify JWT」だけでは、公開されている anon キーでも通ってしまうため、
//     この関数の中で Supabase Auth に問い合わせ、本人のログインであることを確かめる
//     （署名・有効期限の検証は Supabase の認証機構に任せ、こちらで中身を読んで判断しない）。
//   ・Client ID・受け取った応答の全文・利用者のデータはログに出さない。
//   ・画像は URL を返すだけで、保存も再配布もしない。
//   ・画面には Yahoo! のクレジット表示が必要（アプリ側で表示する）。

import { createClient } from 'npm:@supabase/supabase-js@2.117.0';
import {
  buildSearchUrl,
  corsHeaders,
  corsOrigin,
  createRateLimiter,
  describeUpstreamError,
  normalizeJan,
  toCandidates,
} from './lib.ts';

// Deno の型が無い環境（アプリ側の型チェックなど）でも読めるようにしておく。
// 使うものだけを書く。Supabase の Web エディタでは本物の型が優先される。
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

/** Yahoo! 側が返ってこないときに、いつまでも待たないための上限 */
const TIMEOUT_MS = 8000;

/** 1人あたり「10秒で5回」まで。Yahoo! 側の目安（1秒1回）を超えないようにする */
const limiter = createRateLimiter({ limit: 5, windowMs: 10_000 });

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

/**
 * 呼び出し元がログイン済みの利用者かどうかを確かめる。
 *
 * JWT の署名・有効期限などの検証は Supabase の認証機構（auth.getUser）に任せる。
 * 公開されている anon キーは利用者のトークンではないため、ここで弾かれる。
 */
async function isSignedIn(authorization: string | null): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!token) {
    return { ok: false, status: 401, error: 'JANコード検索にはログインが必要です。' };
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    // 設定が足りないときは、利用者を通さずに止める（鍵の値には触れない）
    console.error('SUPABASE_URL / SUPABASE_ANON_KEY が設定されていません');
    return { ok: false, status: 503, error: '商品検索の設定が未完了です。' };
  }

  try {
    const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return { ok: false, status: 401, error: 'JANコード検索にはログインが必要です。ログインし直してからお試しください。' };
    }
    return { ok: true };
  } catch {
    // 認証の確認そのものができないときも、通さない
    console.error('ログイン状態を確認できませんでした');
    return { ok: false, status: 401, error: 'ログイン状態を確認できませんでした。ログインし直してからお試しください。' };
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = corsOrigin(request.headers.get('origin'));

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return json({ error: 'POST で呼び出してください。' }, 405, origin);
  }
  // 知らないサイトからの呼び出しは受け付けない（ブラウザ以外からの呼び出しは origin が無い）
  if (request.headers.get('origin') && !origin) {
    return json({ error: 'この場所からは利用できません。' }, 403, origin);
  }

  // 呼び出し回数の制限。利用者ごとに数える（判別できなければ接続元ごと）
  const caller =
    request.headers.get('authorization')?.slice(-24) ??
    request.headers.get('x-forwarded-for') ??
    'unknown';
  if (!limiter.allow(caller)) {
    return json({ error: '短い時間に検索しすぎています。少し待ってからお試しください。' }, 429, origin);
  }
  limiter.cleanup();

  // ログイン済みの本人かどうかを Supabase Auth に確かめる。
  // ここを通らなければ Yahoo! には一切問い合わせない。
  const signedIn = await isSignedIn(request.headers.get('authorization'));
  if (!signedIn.ok) {
    return json({ error: signedIn.error }, signedIn.status, origin);
  }

  const appId = Deno.env.get('YAHOO_APP_ID');
  if (!appId) {
    // 鍵が無いことだけを伝える（値には触れない）
    console.error('YAHOO_APP_ID が設定されていません');
    return json({ error: '商品検索の設定が未完了です。' }, 503, origin);
  }

  let jan: string | null = null;
  try {
    const body = await request.json();
    jan = normalizeJan((body as { jan?: unknown })?.jan);
  } catch {
    return json({ error: 'リクエストの形式が正しくありません。' }, 400, origin);
  }
  if (!jan) {
    return json({ error: 'JANコード（8桁または13桁）を正しく入力してください。' }, 400, origin);
  }

  try {
    const response = await fetch(buildSearchUrl(appId, jan), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const described = describeUpstreamError(response.status);
      console.error(`商品検索の応答が異常です（HTTP ${response.status}）`); // 本文・鍵は出さない
      return json({ error: described.error }, described.status, origin);
    }
    const candidates = toCandidates(await response.json(), jan);
    return json({ candidates }, 200, origin);
  } catch (e) {
    const timedOut = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
    console.error(`商品検索に失敗しました（${timedOut ? '時間切れ' : '通信エラー'}）`);
    return json(
      { error: timedOut ? '検索に時間がかかっています。もう一度お試しください。' : '商品検索に接続できませんでした。' },
      504,
      origin,
    );
  }
});

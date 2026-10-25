// JANコード検索の「判断する部分」だけを集めたファイル。
//
// 通信も環境変数も使わない純粋な処理なので、そのままテストできる。
// 実際の通信は同じフォルダの index.ts が行う。
//
// 【Yahoo! 側のルール（2026-10 時点で公式ページを確認）】
//   ・Client ID（アプリケーションID）は必須。ブラウザに出さないよう、この関数の中だけで使う。
//   ・短時間に大量のアクセスをすると一定時間使えなくなる（目安 1秒あたり1回）。
//   ・画面にクレジット表示が必要（表示はアプリ側で行う）。
//   ・取得した画像の保存・再配布の可否は公式に記載が見つからないため、URLを参照するだけにする。

/** 画面へ返す商品候補。必要最小限だけにする（受け取った応答をそのまま返さない） */
export interface JanCandidate {
  /** 商品名 */
  name: string;
  /** ブランド名（メーカーの代わりに使える。無ければ空） */
  brand: string;
  /** 商品画像のURL（無ければ null）。保存はせず、表示に使うだけ */
  imageUrl: string | null;
  /** 問い合わせたJANコード */
  jan: string;
}

export type LookupResult =
  | { ok: true; candidates: JanCandidate[] }
  | { ok: false; status: number; error: string };

/** 一度に返す候補の数。多すぎても選びにくいので絞る */
export const MAX_CANDIDATES = 5;

/**
 * JANコードとして使える文字列かどうか。
 * 日本のJANは13桁（標準）と8桁（短縮）。全角数字・ハイフン・空白は直してから判定する。
 */
export function normalizeJan(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '');
  if (!/^\d{8}$|^\d{13}$/.test(digits)) return null;
  return hasValidCheckDigit(digits) ? digits : null;
}

/**
 * 最後の1桁（チェックディジット）が合っているか。
 * 打ち間違いのまま問い合わせて、無駄な通信をしないために確認する。
 */
export function hasValidCheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1).split('').map(Number);
  const expected = Number(digits.slice(-1));
  // 右端から数えて奇数番目を3倍、偶数番目を1倍して合計し、10の倍数にする数が検査数字
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const fromRight = body.length - i; // 1始まり
    sum += body[i] * (fromRight % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === expected;
}

/** 問い合わせ先のURL（Client ID は呼び出し側が渡す。ここには書かない） */
export function buildSearchUrl(appId: string, jan: string): string {
  const url = new URL('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch');
  url.searchParams.set('appid', appId);
  url.searchParams.set('jan_code', jan);
  url.searchParams.set('results', String(MAX_CANDIDATES));
  return url.toString();
}

/** 受け取った応答から、画面に必要な項目だけを取り出す */
export function toCandidates(payload: unknown, jan: string): JanCandidate[] {
  const hits = (payload as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) return [];

  const seen = new Set<string>();
  const candidates: JanCandidate[] = [];
  for (const hit of hits) {
    const item = hit as { name?: unknown; brand?: { name?: unknown }; image?: { medium?: unknown; small?: unknown } };
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    candidates.push({
      name,
      brand: typeof item.brand?.name === 'string' ? item.brand.name.trim() : '',
      imageUrl: pickImage(item.image),
      jan,
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

function pickImage(image: { medium?: unknown; small?: unknown } | undefined): string | null {
  for (const value of [image?.medium, image?.small]) {
    if (typeof value === 'string' && /^https:\/\//.test(value)) return value;
  }
  return null;
}

/** Yahoo! 側の失敗を、画面に出せる日本語にする（内部の詳細はそのまま出さない） */
export function describeUpstreamError(status: number): { status: number; error: string } {
  if (status === 429) {
    return { status: 429, error: '検索が混み合っています。少し待ってからもう一度お試しください。' };
  }
  if (status === 400) {
    return { status: 400, error: 'JANコードの形式が正しくありません。' };
  }
  if (status === 401 || status === 403) {
    // 鍵の問題。利用者には詳細を出さず、管理者が気づけるようにする
    return { status: 502, error: '商品検索の設定に問題があります。しばらくしてからお試しください。' };
  }
  return { status: 502, error: '商品検索に失敗しました。時間をおいてからお試しください。' };
}

// ---------- 呼び出し回数の制限（この関数が踏み台にされないように） ----------

export interface RateLimitOptions {
  /** 何回まで許すか */
  limit: number;
  /** 何ミリ秒あたりか */
  windowMs: number;
}

/**
 * 同じ利用者からの呼び出し回数を数える。
 * Yahoo! 側の「1秒あたり1回」の目安を超えないよう、こちら側でも抑える。
 */
export function createRateLimiter({ limit, windowMs }: RateLimitOptions) {
  const hits = new Map<string, number[]>();
  return {
    /** 呼び出してよければ true。だめなら false */
    allow(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    /** 古い記録を捨てる（メモリを増やし続けないため） */
    cleanup(now = Date.now()): void {
      for (const [key, times] of hits) {
        const recent = times.filter((t) => now - t < windowMs);
        if (recent.length === 0) hits.delete(key);
        else hits.set(key, recent);
      }
    },
  };
}

// ---------- 呼び出し元の制限（知らないサイトから使われないように） ----------

/** この関数を呼べるサイト */
export const ALLOWED_ORIGINS = [
  'https://12kodakara.github.io',
  'http://localhost:5173',
  'http://localhost:4273',
  'http://localhost:5273',
];

/** 許可したサイトからの呼び出しかどうか。許可外なら null（ヘッダーを返さない） */
export function corsOrigin(origin: string | null, allowed: string[] = ALLOWED_ORIGINS): string | null {
  if (!origin) return null;
  return allowed.includes(origin) ? origin : null;
}

/**
 * ブラウザから送られてくるヘッダーのうち、事前確認（OPTIONS）で許可するもの。
 * supabase-js は authorization・apikey のほかに x-client-info（ライブラリの版）などを
 * 自動で付けるため、ここに並べておかないとブラウザが本番の通信を止めてしまう。
 */
export const ALLOWED_HEADERS = 'authorization, apikey, content-type, x-client-info, x-supabase-api-version';

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

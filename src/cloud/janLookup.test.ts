import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  corsHeaders,
  corsOrigin,
  createRateLimiter,
  describeUpstreamError,
  hasValidCheckDigit,
  normalizeJan,
  toCandidates,
  MAX_CANDIDATES,
} from '../../supabase/functions/jan-lookup/lib';

// JANコード検索（Supabase Edge Function）の判断部分のテスト。
// 外部のサービスへは接続せず、手元で作った応答だけを使う。

describe('JANコードの確認', () => {
  it('13桁・8桁の正しいコードを受け付ける', () => {
    expect(normalizeJan('4902102072618')).toBe('4902102072618'); // 13桁
    expect(normalizeJan('49012347')).toBe('49012347'); // 8桁（検査数字つき）
  });

  it('全角数字・ハイフン・空白が入っていても読み取る', () => {
    expect(normalizeJan('４９０２１０２０７２６１８')).toBe('4902102072618');
    expect(normalizeJan(' 4902102-072618 ')).toBe('4902102072618');
  });

  it('★桁数が違う・数字でない・最後の1桁が合わないものは受け付けない', () => {
    expect(normalizeJan('490210207261')).toBeNull(); // 12桁
    expect(normalizeJan('49021020726180')).toBeNull(); // 14桁
    expect(normalizeJan('abcdefghijklm')).toBeNull();
    expect(normalizeJan('4902102072619')).toBeNull(); // 検査数字が違う（打ち間違い）
    expect(normalizeJan('')).toBeNull();
    expect(normalizeJan(undefined)).toBeNull();
    expect(normalizeJan(12345678)).toBeNull(); // 文字列でない
  });

  it('検査数字の計算が正しい', () => {
    expect(hasValidCheckDigit('4902102072618')).toBe(true);
    expect(hasValidCheckDigit('4902102072617')).toBe(false);
  });
});

describe('問い合わせ先のURL', () => {
  it('JANコードと件数を付け、鍵は引数で受け取る（コードに書かない）', () => {
    const url = new URL(buildSearchUrl('TEST-ID', '4902102072618'));
    expect(url.origin + url.pathname).toBe('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch');
    expect(url.searchParams.get('jan_code')).toBe('4902102072618');
    expect(url.searchParams.get('appid')).toBe('TEST-ID');
    expect(Number(url.searchParams.get('results'))).toBe(MAX_CANDIDATES);
  });
});

describe('応答から画面に出す項目だけを取り出す', () => {
  const payload = {
    totalResultsAvailable: 2,
    hits: [
      {
        name: 'やさしい麦茶 2L×6本',
        brand: { name: 'サントリー' },
        image: { small: 'https://example.com/s.jpg', medium: 'https://example.com/m.jpg' },
        price: 980,
        url: 'https://shopping.example.com/item',
        seller: { name: 'テスト商店' },
      },
      { name: '別の商品', brand: {}, image: {} },
    ],
  };

  it('★商品名・ブランド・画像URLだけを返す（価格や店名は返さない）', () => {
    const [first] = toCandidates(payload, '4902102072618');
    expect(first).toEqual({
      name: 'やさしい麦茶 2L×6本',
      brand: 'サントリー',
      imageUrl: 'https://example.com/m.jpg', // 大きい方を使う
      jan: '4902102072618',
    });
    expect(Object.keys(first)).toEqual(['name', 'brand', 'imageUrl', 'jan']);
  });

  it('ブランド・画像が無くても壊れない', () => {
    expect(toCandidates(payload, '4902102072618')[1]).toMatchObject({ name: '別の商品', brand: '', imageUrl: null });
  });

  it('同じ商品名は1件にまとめ、最大5件までにする', () => {
    const many = { hits: [...Array(12)].map((_, i) => ({ name: i < 3 ? '同じ商品' : `商品${i}` })) };
    const candidates = toCandidates(many, '49012347');
    expect(candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(candidates.filter((c) => c.name === '同じ商品')).toHaveLength(1);
  });

  it('該当なし・応答が想定外でも空の一覧を返す', () => {
    expect(toCandidates({ hits: [] }, '49012347')).toEqual([]);
    expect(toCandidates({}, '49012347')).toEqual([]);
    expect(toCandidates(null, '49012347')).toEqual([]);
  });

  it('画像URLが https でなければ使わない（混在コンテンツを避ける）', () => {
    const insecure = { hits: [{ name: '商品', image: { medium: 'http://example.com/m.jpg' } }] };
    expect(toCandidates(insecure, '49012347')[0].imageUrl).toBeNull();
  });
});

describe('失敗したときの案内', () => {
  it('混み合っているとき（429）はそのまま伝える', () => {
    expect(describeUpstreamError(429)).toMatchObject({ status: 429 });
    expect(describeUpstreamError(429).error).toContain('混み合って');
  });

  it('★鍵の問題（401・403）でも、利用者には詳細を出さない', () => {
    for (const status of [401, 403]) {
      const described = describeUpstreamError(status);
      expect(described.status).toBe(502);
      expect(described.error).not.toMatch(/key|appid|Client ID|401|403/i);
    }
  });

  it('それ以外は「検索に失敗」として返す', () => {
    expect(describeUpstreamError(500)).toMatchObject({ status: 502 });
  });
});

describe('呼び出し回数の制限', () => {
  it('★決めた回数を超えたら断る', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    const now = 1_000_000;
    expect([0, 1, 2].every((i) => limiter.allow('user', now + i))).toBe(true);
    expect(limiter.allow('user', now + 3)).toBe(false);
  });

  it('時間が経てばまた使える', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow('user', 0)).toBe(true);
    expect(limiter.allow('user', 500)).toBe(false);
    expect(limiter.allow('user', 1500)).toBe(true);
  });

  it('利用者ごとに別で数える', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('b', 0)).toBe(true);
    expect(limiter.allow('a', 1)).toBe(false);
  });

  it('古い記録は捨てる（記録がたまり続けない）', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.allow('a', 0);
    limiter.cleanup(5000);
    expect(limiter.allow('a', 5001)).toBe(true);
  });
});

describe('呼び出し元の制限', () => {
  it('★公開サイトと開発用のアドレスだけ許可する', () => {
    expect(corsOrigin('https://12kodakara.github.io')).toBe('https://12kodakara.github.io');
    expect(corsOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('★知らないサイトからは許可しない', () => {
    expect(corsOrigin('https://evil.example.com')).toBeNull();
    expect(corsOrigin('http://12kodakara.github.io')).toBeNull(); // httpは不可
    expect(corsOrigin(null)).toBeNull();
  });

  it('許可しないときはヘッダーを返さない', () => {
    expect(corsHeaders(null)).toEqual({});
    expect(corsHeaders('https://12kodakara.github.io')['access-control-allow-origin']).toBe('https://12kodakara.github.io');
    // supabase-js が自動で付けるヘッダーを許可していないと、ブラウザが通信を止めてしまう
    const allowed = corsHeaders('https://12kodakara.github.io')['access-control-allow-headers'].split(/,\s*/);
    expect(allowed).toEqual(expect.arrayContaining(['authorization', 'apikey', 'content-type', 'x-client-info']));
  });
});

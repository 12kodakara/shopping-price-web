import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeFunctionError, lookupJan } from './janLookup';
import { getSupabase } from './supabaseClient';

// 画面側のJANコード検索。外部へは接続せず、差し替えたクライアントで確かめる。
vi.mock('./supabaseClient', () => ({ getSupabase: vi.fn() }));
const mockedGetSupabase = vi.mocked(getSupabase);

/** ログイン状態と応答を指定できるニセのクライアント */
function fakeClient(session: object | null, response: { data?: unknown; error?: unknown } = {}) {
  const invoke = vi.fn(async () => ({ data: response.data ?? null, error: response.error ?? null }));
  return { auth: { getSession: async () => ({ data: { session }, error: null }) }, functions: { invoke } };
}

beforeEach(() => mockedGetSupabase.mockReset());

describe('JANコード検索（画面側）', () => {
  it('★JANコードが正しくなければ、通信せずに知らせる', async () => {
    const client = fakeClient({});
    mockedGetSupabase.mockResolvedValue(client as never);
    const result = await lookupJan('123');
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain('8桁または13桁');
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  it('★ログインしていなければ検索しない（手入力は続けられる）', async () => {
    const client = fakeClient(null);
    mockedGetSupabase.mockResolvedValue(client as never);
    const result = await lookupJan('4902102072618');
    expect(result.ok === false && result.error).toContain('ログイン');
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  it('クラウド未設定なら、その旨を返す', async () => {
    mockedGetSupabase.mockResolvedValue(null);
    expect(await lookupJan('4902102072618')).toMatchObject({ ok: false });
  });

  it('★見つかった候補をそのまま返し、全角やハイフンも読み取る', async () => {
    const candidates = [{ name: '麦茶', brand: 'サントリー', imageUrl: null, jan: '4902102072618' }];
    const client = fakeClient({}, { data: { candidates } });
    mockedGetSupabase.mockResolvedValue(client as never);

    const result = await lookupJan('４９０２１０２-０７２６１８');
    expect(result).toEqual({ ok: true, candidates });
    expect(client.functions.invoke).toHaveBeenCalledWith('jan-lookup', { body: { jan: '4902102072618' } });
  });

  it('該当なしは「空の一覧」として返す（エラーにしない）', async () => {
    mockedGetSupabase.mockResolvedValue(fakeClient({}, { data: { candidates: [] } }) as never);
    expect(await lookupJan('4902102072618')).toEqual({ ok: true, candidates: [] });
  });

  it('応答が想定外のときは、その旨を返す', async () => {
    mockedGetSupabase.mockResolvedValue(fakeClient({}, { data: { ng: true } }) as never);
    expect(await lookupJan('4902102072618')).toMatchObject({ ok: false });
  });

  it('失敗の理由を日本語にする（内部の詳細は出さない）', () => {
    expect(describeFunctionError({ context: { status: 401 } })).toContain('ログイン');
    expect(describeFunctionError({ context: { status: 429 } })).toContain('待って');
    expect(describeFunctionError({ context: { status: 503 } })).toContain('準備');
    expect(describeFunctionError({ context: { status: 504 } })).toContain('時間');
    expect(describeFunctionError({ message: 'Internal' })).not.toMatch(/Internal|appid|key/i);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleData } from '../data/mockData';
import { describeCloudError, getCloudCounts, getCloudData, replaceCloudData } from './cloudRepository';
import { getSupabase } from './supabaseClient';

// Supabase クライアントを差し替えて、「ログインしていないときに何もしない」ことを確かめる。
// 実際のデータベースを守るのは Supabase 側の RLS（supabase/migrations/…）で、
// ここで確かめるのは「アプリ側もログインしていなければ一切アクセスしない」こと。
vi.mock('./supabaseClient', () => ({ getSupabase: vi.fn() }));

const mockedGetSupabase = vi.mocked(getSupabase);

/** from() が呼ばれたかどうかを記録するだけのニセのクライアント */
function fakeClient(session: { user: { id: string } } | null) {
  const from = vi.fn(() => {
    throw new Error('ログインしていないのにテーブルへアクセスしました');
  });
  return {
    from,
    auth: { getSession: async () => ({ data: { session }, error: null }) },
  };
}

beforeEach(() => {
  mockedGetSupabase.mockReset();
});

describe('クラウド未設定のとき', () => {
  it('件数の取得も保存もしない', async () => {
    mockedGetSupabase.mockResolvedValue(null);
    expect(await getCloudCounts()).toEqual({ ok: false, error: 'クラウド同期が設定されていません' });
    expect(await getCloudData()).toEqual({ ok: false, error: 'クラウド同期が設定されていません' });
    expect(await replaceCloudData(createSampleData())).toEqual({ ok: false, error: 'クラウド同期が設定されていません' });
  });
});

describe('ログインしていないとき', () => {
  it('★クラウドのデータを取得しない（テーブルにアクセスしない）', async () => {
    const client = fakeClient(null);
    mockedGetSupabase.mockResolvedValue(client as never);

    const counts = await getCloudCounts();
    expect(counts.ok).toBe(false);
    const data = await getCloudData();
    expect(data.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('★クラウドへ書き込まない（テーブルにアクセスしない）', async () => {
    const client = fakeClient(null);
    mockedGetSupabase.mockResolvedValue(client as never);

    const result = await replaceCloudData(createSampleData());
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain('ログインしていません');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('送る前の確認', () => {
  it('壊れたデータはクラウドへ送らない', async () => {
    const client = fakeClient({ user: { id: '11111111-1111-1111-1111-111111111111' } });
    mockedGetSupabase.mockResolvedValue(client as never);

    const broken = { ...createSampleData(), products: [{ id: 'X999', name: '' }] } as never;
    const result = await replaceCloudData(broken);
    expect(result).toMatchObject({ ok: false });
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('エラーの説明', () => {
  it('テーブルが無いときは、準備がまだであることを伝える', () => {
    expect(describeCloudError({ code: 'PGRST205', message: "Could not find the table 'public.products'" }, 'x')).toContain('テーブルの作成');
  });

  it('RLS に拒否されたときは、ログインし直しを促す', () => {
    expect(describeCloudError({ code: '42501', message: 'new row violates row-level security policy' }, 'x')).toContain('許可されませんでした');
  });

  it('通信できないときは、その旨と端末のデータが無事であることを伝える', () => {
    expect(describeCloudError({ message: 'Failed to fetch' }, 'x')).toContain('この端末のデータはそのままです');
  });

  it('分からないときは、もとの説明を添えて返す', () => {
    expect(describeCloudError({ message: 'something odd' }, '保存できませんでした')).toBe('保存できませんでした（something odd）');
  });
});

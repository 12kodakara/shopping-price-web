// クラウド（Supabase）側のデータの読み書き。
//
// ・画面からは直接 Supabase を呼ばず、必ずここを通す。
// ・ここは localStorage を一切変更しない（端末のデータを書き換えるのは画面側 → repository.restore）。
// ・失敗したときは日本語の理由を返すだけで、端末のデータには何もしない。
// ・ログインしていなければ何もしない（RLS により、そもそもクラウド側も拒否する）。

import { loadAppData } from '../data/schema';
import type { AppData } from '../data/types';
import {
  countsOf,
  fromRows,
  toRows,
  type DataCounts,
  type PriceRecordRow,
  type ProductRow,
  type ShoppingItemRow,
  type StoreRow,
  type UserSettingsRow,
} from './cloudRows';
import { getSupabase } from './supabaseClient';

export type CloudResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 一度に送る行数。大量データでもリクエストが大きくなりすぎないように分割する */
const CHUNK = 500;

type Client = NonNullable<Awaited<ReturnType<typeof getSupabase>>>;

interface PostgrestLikeError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/** Supabase のエラーを、利用者に見せる短い日本語にする（値や内部情報は出さない） */
export function describeCloudError(error: PostgrestLikeError | null, fallback: string): string {
  const message = error?.message ?? '';
  const code = error?.code ?? '';
  // テーブルがまだ無い（migration 未適用）
  if (code === 'PGRST205' || code === '42P01' || /does not exist|could not find the table/i.test(message)) {
    return 'クラウド側の準備（テーブルの作成）がまだ済んでいません。supabase/README.md の手順で SQL を実行してください。';
  }
  // RLS により拒否された
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'クラウドのデータへのアクセスが許可されませんでした。ログインし直してからもう一度お試しください。';
  }
  if (/jwt|token is expired|invalid claim/i.test(message)) {
    return 'ログインの有効期限が切れています。ログインし直してください。';
  }
  if (/fetch|network|failed to fetch/i.test(message)) {
    return '通信できませんでした。電波の良い場所でもう一度お試しください（この端末のデータはそのままです）。';
  }
  return message ? `${fallback}（${message}）` : fallback;
}

/** ログイン中のクライアントと利用者IDを取り出す */
async function requireSession(): Promise<CloudResult<{ client: Client; userId: string }>> {
  const client = await getSupabase();
  if (!client) return { ok: false, error: 'クラウド同期が設定されていません' };
  const { data, error } = await client.auth.getSession();
  if (error) return { ok: false, error: describeCloudError(error, 'ログイン状態を確認できませんでした') };
  const userId = data.session?.user.id;
  if (!userId) return { ok: false, error: 'ログインしていません。先にログインしてください。' };
  return { ok: true, value: { client, userId } };
}

/** 件数だけを数える（本文は受け取らない）。onlyPurchased のときは購入済みだけ */
async function countOf(client: Client, table: string, onlyPurchased = false): Promise<CloudResult<number>> {
  const base = client.from(table).select('*', { count: 'exact', head: true });
  const { count, error } = await (onlyPurchased ? base.eq('purchased', true) : base);
  if (error) return { ok: false, error: describeCloudError(error, 'クラウドの件数を取得できませんでした') };
  return { ok: true, value: count ?? 0 };
}

/** クラウド側の状態（件数と、最後に保存した日時） */
export interface CloudStatus {
  counts: DataCounts;
  /** 最後に「クラウドへ保存」した日時（ISO 8601）。一度も保存していなければ null */
  lastSyncedAt: string | null;
}

/** クラウド側の件数と最終保存日時（本人の分だけ。RLS により他人の行は数にも入らない） */
export async function getCloudStatus(): Promise<CloudResult<CloudStatus>> {
  const session = await requireSession();
  if (!session.ok) return session;
  const { client } = session.value;

  const products = await countOf(client, 'products');
  if (!products.ok) return products;
  const stores = await countOf(client, 'stores');
  if (!stores.ok) return stores;
  const priceRecords = await countOf(client, 'price_records');
  if (!priceRecords.ok) return priceRecords;
  const shoppingList = await countOf(client, 'shopping_items');
  if (!shoppingList.ok) return shoppingList;
  const purchased = await countOf(client, 'shopping_items', true);
  if (!purchased.ok) return purchased;

  // 最後に保存した日時（設定の行。まだ無ければ null）
  const { data: settings, error: settingsError } = await client.from('user_settings').select('last_synced_at').limit(1);
  if (settingsError) return { ok: false, error: describeCloudError(settingsError, 'クラウドの状態を取得できませんでした') };
  const lastSyncedAt = (settings?.[0] as { last_synced_at?: string | null } | undefined)?.last_synced_at ?? null;

  return {
    ok: true,
    value: {
      counts: {
        products: products.value,
        stores: stores.value,
        priceRecords: priceRecords.value,
        shoppingList: shoppingList.value,
        purchased: purchased.value,
      },
      lastSyncedAt,
    },
  };
}

/** クラウド側のデータを取り出して、端末の保存データと同じ形にする（端末のデータは変更しない） */
export async function getCloudData(): Promise<CloudResult<AppData>> {
  const session = await requireSession();
  if (!session.ok) return session;
  const { client } = session.value;

  const tables = ['products', 'stores', 'price_records', 'shopping_items', 'user_settings'] as const;
  const results: Record<string, unknown[]> = {};
  for (const table of tables) {
    const { data, error } = await client.from(table).select('*');
    if (error) return { ok: false, error: describeCloudError(error, 'クラウドのデータを取得できませんでした') };
    results[table] = data ?? [];
  }

  const json = fromRows({
    products: results.products as ProductRow[],
    stores: results.stores as StoreRow[],
    priceRecords: results.price_records as PriceRecordRow[],
    shoppingItems: results.shopping_items as ShoppingItemRow[],
    settings: (results.user_settings[0] as UserSettingsRow | undefined) ?? null,
  });

  const loaded = loadAppData(json);
  if (!loaded.ok) return { ok: false, error: `クラウドのデータを読み込めませんでした（${loaded.reason}）` };
  return { ok: true, value: loaded.data };
}

/**
 * この端末のデータでクラウドを置き換える。
 * 送る前に検証し、送信中に失敗しても端末のデータには一切触れない。
 */
export async function replaceCloudData(data: AppData): Promise<CloudResult<DataCounts>> {
  const checked = loadAppData(data);
  if (!checked.ok) return { ok: false, error: `この端末のデータを確認できませんでした（${checked.reason}）` };

  const session = await requireSession();
  if (!session.ok) return session;
  const { client, userId } = session.value;
  const rows = toRows(userId, checked.data);

  // 消す順番は、参照している側から（価格記録・買い物リスト → 商品・店舗）
  for (const table of ['price_records', 'shopping_items', 'products', 'stores'] as const) {
    const { error } = await client.from(table).delete().eq('user_id', userId);
    if (error) return { ok: false, error: describeCloudError(error, 'クラウドの古いデータを整理できませんでした') };
  }

  // 入れる順番は逆（商品・店舗 → 価格記録・買い物リスト）
  const inserts: [string, object[]][] = [
    ['products', rows.products],
    ['stores', rows.stores],
    ['price_records', rows.priceRecords],
    ['shopping_items', rows.shoppingItems],
  ];
  for (const [table, all] of inserts) {
    for (let i = 0; i < all.length; i += CHUNK) {
      const { error } = await client.from(table).insert(all.slice(i, i + CHUNK));
      if (error) return { ok: false, error: describeCloudError(error, 'クラウドへ保存できませんでした') };
    }
  }

  const { error: settingsError } = await client
    .from('user_settings')
    .upsert({ ...rows.settings, last_synced_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (settingsError) return { ok: false, error: describeCloudError(settingsError, 'クラウドへ保存できませんでした') };

  return { ok: true, value: countsOf(checked.data) };
}

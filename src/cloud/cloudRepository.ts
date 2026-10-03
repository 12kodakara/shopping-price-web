// クラウド（Supabase）側のデータの読み書き。
//
// ・画面からは直接 Supabase を呼ばず、必ずここを通す。
// ・ここは localStorage を一切変更しない（端末のデータを書き換えるのは画面側 → repository.restore）。
// ・失敗したときは日本語の理由を返すだけで、端末のデータには何もしない。
// ・ログインしていなければ何もしない（RLS により、そもそもクラウド側も拒否する）。

import { loadAppData } from '../data/schema';
import { isValidQuantity } from '../lib/validation';
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

/**
 * 読み取りの待ち時間の上限。
 * 応答が返らないとき（電波が弱い・接続が途中で止まる など）に画面が待ち続けないようにする。
 * ※ライブラリ側が通信エラーと 503（クラウド側の準備中）を自動で3回まで再試行するため、少し長めにとる。
 */
const READ_TIMEOUT_MS = 20000;

type Client = NonNullable<Awaited<ReturnType<typeof getSupabase>>>;

interface PostgrestLikeError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * Supabase のエラーを、利用者に見せる短い日本語にする。
 *
 * 原因が分かるように、最後は「HTTP 状態番号 / エラーコード」を添える。
 * ここに出すのは仕組み上の番号だけで、キー・トークン・メールアドレス・データの中身は一切含めない。
 */
export function describeCloudError(error: PostgrestLikeError | null, fallback: string, status?: number): string {
  const message = error?.message ?? '';
  const code = error?.code ?? '';

  // テーブルがまだ無い（migration 未適用、または PostgREST の一覧が古い）
  if (code === 'PGRST205' || code === '42P01' || /does not exist|could not find the table/i.test(message)) {
    return 'クラウド側の準備（テーブルの作成）がまだ済んでいません。supabase/README.md の手順で SQL を実行してください。';
  }
  // テーブルを使う権限（GRANT）が付いていない。SQL の実行漏れで起きる
  if (code === '42501' || /permission denied/i.test(message)) {
    return 'クラウド側の権限設定がまだ適用されていません。supabase/README.md の手順で supabase/migrations/ の SQL（20260927000001_grants.sql を含む）を実行してください。';
  }
  // 認証の期限切れ
  if (status === 401 || code === 'PGRST301' || /jwt|token is expired|invalid claim/i.test(message)) {
    return 'ログインの有効期限が切れています。いったんログアウトして、ログインし直してください。';
  }
  // RLS により拒否された
  if (status === 403 || /row-level security/i.test(message)) {
    return 'クラウドのデータへのアクセスが許可されませんでした。ログインし直してからもう一度お試しください。';
  }
  if (/abort|timeout|timed out|signal is aborted/i.test(message)) {
    return '時間内にクラウドから応答がありませんでした。通信状況を確認して、もう一度お試しください（この端末のデータはそのままです）。';
  }
  if (/fetch|network|failed to fetch|load failed/i.test(message)) {
    return '通信できませんでした。電波の良い場所でもう一度お試しください（この端末のデータはそのままです）。';
  }

  // ここまでで分からないとき。調査の手がかりになる番号だけを添える
  const hints = [status ? `HTTP ${status}` : '', code ? `コード ${code}` : '', message].filter(Boolean);
  return hints.length > 0 ? `${fallback}（${hints.join(' / ')}）` : fallback;
}

/**
 * 通信そのものが失敗した（オフライン等）ときは例外が飛ぶことがある。
 * 画面側で扱えるように、必ず結果（ok:false）に変える。
 */
async function guard<T>(fallback: string, run: () => Promise<CloudResult<T>>): Promise<CloudResult<T>> {
  try {
    return await run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: describeCloudError({ message }, fallback) };
  }
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

/**
 * 件数を数える。
 *
 * HEAD（本文なし）では応答の本文が空になり、失敗したときに Supabase が返す理由
 * （テーブルが無い・権限が無い など）が読めなくなるため、GET で1行だけ取って数える。
 * 取り出す列は user_id（＝ログイン中の本人のID）だけなので、中身のデータは受け取らない。
 */
async function countOf(client: Client, table: string, onlyPurchased = false): Promise<CloudResult<number>> {
  const base = client.from(table).select('user_id', { count: 'exact' }).limit(1).abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS));
  const { count, error, status } = await (onlyPurchased ? base.eq('purchased', true) : base);
  if (error) return { ok: false, error: describeCloudError(error, 'クラウドの件数を取得できませんでした', status) };
  // 件数のヘッダー（content-range）が読めなかった場合。0件と誤って表示しないようエラーにする
  if (count === null || count === undefined) {
    return {
      ok: false,
      error:
        'クラウドの件数を取得できませんでした（応答に件数の情報がありません / HTTP ' +
        `${status ?? '不明'}）。クラウド側の準備（テーブルの作成）が終わっていないか、通信が遮られている可能性があります。`,
    };
  }
  return { ok: true, value: count };
}

/** クラウド側の状態（件数と、最後に保存した日時） */
export interface CloudStatus {
  counts: DataCounts;
  /** 最後に「クラウドへ保存」した日時（ISO 8601）。一度も保存していなければ null */
  lastSyncedAt: string | null;
}

/** クラウド側の件数と最終保存日時（本人の分だけ。RLS により他人の行は数にも入らない） */
export async function getCloudStatus(): Promise<CloudResult<CloudStatus>> {
  return guard('クラウドの状態を取得できませんでした', () => getCloudStatusInner());
}

async function getCloudStatusInner(): Promise<CloudResult<CloudStatus>> {
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
  const { data: settings, error: settingsError, status: settingsStatus } = await client.from('user_settings').select('last_synced_at').limit(1);
  if (settingsError) return { ok: false, error: describeCloudError(settingsError, 'クラウドの状態を取得できませんでした', settingsStatus) };
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
  return guard('クラウドのデータを取得できませんでした', () => getCloudDataInner());
}

async function getCloudDataInner(): Promise<CloudResult<AppData>> {
  const session = await requireSession();
  if (!session.ok) return session;
  const { client } = session.value;

  const { userId } = session.value;
  const tables = ['products', 'stores', 'price_records', 'shopping_items', 'user_settings'] as const;
  const results: Record<string, unknown[]> = {};
  for (const table of tables) {
    // 本人の行だけを取る。クラウド側でも RLS が同じ条件で絞るが、こちら側でも明示して二重にする
    const { data, error, status } = await client
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS));
    if (error) return { ok: false, error: describeCloudError(error, 'クラウドのデータを取得できませんでした', status) };
    const rows = data ?? [];
    // 万一ほかの利用者の行が混ざっていたら、端末には一切取り込まずに中止する
    if (rows.some((row) => (row as { user_id?: string }).user_id !== userId)) {
      return { ok: false, error: 'クラウドから受け取ったデータに、ほかの利用者のものが含まれていました。安全のため取り込みを中止しました。' };
    }
    results[table] = rows;
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
  return guard('クラウドへ保存できませんでした', () => replaceCloudDataInner(data));
}

/** 置き換えの対象（user_settings は最後に別で保存する） */
type DataTable = 'products' | 'stores' | 'price_records' | 'shopping_items';
type TableRows = Record<DataTable, object[]>;
/** 消す順番は、参照している側から（価格記録・買い物リスト → 商品・店舗） */
const DELETE_ORDER: DataTable[] = ['price_records', 'shopping_items', 'products', 'stores'];
/** 入れる順番は逆（商品・店舗 → 価格記録・買い物リスト） */
const INSERT_ORDER: DataTable[] = ['products', 'stores', 'price_records', 'shopping_items'];

interface WriteFailure {
  error: PostgrestLikeError | null;
  status?: number;
}

/** 本人の行を消してから、渡された行を入れる。失敗したらその時点で止め、理由を返す（成功なら null） */
async function writeAllTables(client: Client, userId: string, rows: TableRows): Promise<WriteFailure | null> {
  try {
    for (const table of DELETE_ORDER) {
      const { error, status } = await client.from(table).delete().eq('user_id', userId);
      if (error) return { error, status };
    }
    for (const table of INSERT_ORDER) {
      const all = rows[table];
      for (let i = 0; i < all.length; i += CHUNK) {
        const { error, status } = await client.from(table).insert(all.slice(i, i + CHUNK));
        if (error) return { error, status };
      }
    }
    return null;
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

async function replaceCloudDataInner(data: AppData): Promise<CloudResult<DataCounts>> {
  const checked = loadAppData(data);
  if (!checked.ok) return { ok: false, error: `この端末のデータを確認できませんでした（${checked.reason}）` };

  // 販売数量は「1本」「6本」のような個数なので、小数や0以下のものはクラウドへ送らない。
  // いまの画面では入力できないが、古いデータや手で編集したデータが混ざっていないかをここでも確かめる。
  const badQuantity = checked.data.priceRecords.find((r) => !isValidQuantity(r.quantity));
  if (badQuantity) {
    return {
      ok: false,
      error:
        `価格履歴 ${badQuantity.id} の販売数量（${badQuantity.quantity}）が正しくありません。` +
        '販売数量は1以上の整数です。価格履歴の「修正」で直してから、もう一度保存してください。',
    };
  }

  const session = await requireSession();
  if (!session.ok) return session;
  const { client, userId } = session.value;
  const rows = toRows(userId, checked.data);

  // 第16回: 置き換える前に、いまのクラウドの内容を控えておく。
  // 途中で失敗したときに書き戻し、「一部の表だけ新しい・一部は空」という中途半端な状態を残さないため。
  // 控えが取れなければ、クラウドには一切手を付けずに中止する。
  const before = {} as TableRows;
  for (const table of INSERT_ORDER) {
    const { data: current, error, status } = await client
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS));
    if (error) {
      return {
        ok: false,
        error: `${describeCloudError(error, 'クラウドの現在の内容を確認できませんでした', status)}。保存は行っていません（クラウド・この端末とも変更なし）。`,
      };
    }
    before[table] = current ?? [];
  }

  const failure = await writeAllTables(client, userId, {
    products: rows.products,
    stores: rows.stores,
    price_records: rows.priceRecords,
    shopping_items: rows.shoppingItems,
  });
  if (failure) {
    const reason = describeCloudError(failure.error, 'クラウドへ保存できませんでした', failure.status);
    const rollback = await writeAllTables(client, userId, before);
    return {
      ok: false,
      error: rollback
        ? `${reason}。クラウドの内容が途中までの状態になっている可能性があります。もう一度「この端末のデータをクラウドへ保存」を実行してください（この端末のデータはそのままです）。`
        : `${reason}。クラウドは保存前の内容に戻しました（この端末のデータはそのままです）。`,
    };
  }

  const { error: settingsError, status: settingsStatus } = await client
    .from('user_settings')
    .upsert({ ...rows.settings, last_synced_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (settingsError) {
    return {
      ok: false,
      error: `データはクラウドへ保存しましたが、保存日時を記録できませんでした（${describeCloudError(settingsError, 'クラウドへ保存できませんでした', settingsStatus)}）。`,
    };
  }

  return { ok: true, value: countsOf(checked.data) };
}

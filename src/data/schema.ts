import { isValidDate } from '../lib/date';
import { CURRENT_VERSION, type AppData, type PriceRecord, type Product, type Store } from './types';

// 保存データ・バックアップファイルの読み込み処理。
// localStorage からの読み込みも、バックアップからの復元も、必ず同じ手順を通す。
//
//   ① JSONとして読む（parseJson）
//   ② version を確認する（readVersion）
//   ③ 古い version なら現在の形式へ移行する（migrate）
//   ③' 後から追加した省略可能な項目に既定値を補う（applyDefaults）
//   ④ 現在の形式として正しいか検証する（validateCurrent）
//   ⑤ 必要な項目だけを取り出して repository へ渡す（normalize）
//
// どの段階で失敗しても、データの削除・修正はしない（呼び出し側は「壊れている」と扱うだけ）。

export { CURRENT_VERSION };

export type ParseResult = { ok: true; data: AppData } | { ok: false; reason: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyStr = (v: unknown): v is string => isStr(v) && v.trim() !== '';
const isOptStr = (v: unknown) => v === undefined || isStr(v);
const isOptBool = (v: unknown) => v === undefined || typeof v === 'boolean';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** ID の形式（P001, S010, R011 のように、接頭辞 + 数字） */
export const ID_PATTERNS = { product: /^P\d+$/, store: /^S\d+$/, record: /^R\d+$/ } as const;

// ---------- ① JSON ----------

export function parseJson(raw: string): { ok: true; json: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: 'JSONとして読み込めません（ファイルが壊れているか、別の形式のファイルです）' };
  }
}

// ---------- ② version ----------

export function readVersion(json: unknown): { ok: true; version: number } | { ok: false; reason: string } {
  if (!isObj(json)) return { ok: false, reason: 'データの形式が正しくありません' };
  if (json.version === undefined) return { ok: false, reason: 'データの形式が正しくありません（version がありません）' };
  if (!Number.isInteger(json.version)) return { ok: false, reason: `データの形式が正しくありません（version: ${String(json.version)}）` };
  const version = json.version as number;
  if (version > CURRENT_VERSION) {
    return { ok: false, reason: `このアプリより新しい形式のデータです（version: ${version}）。アプリを更新してから読み込んでください` };
  }
  if (version < 1 || !(version === CURRENT_VERSION || migrations[version])) {
    return { ok: false, reason: `対応していないデータ形式です（version: ${version}）` };
  }
  return { ok: true, version };
}

// ---------- ③ 移行 ----------

/**
 * 古い version から1つ新しい version へ変換する処理。
 * 例: version 2 を作るときは `1: (d) => ({ ...d, version: 2, 新しい項目: 初期値 })` を追加する。
 * 変換は元のオブジェクトを書き換えず、新しいオブジェクトを返すこと。
 */
const migrations: Record<number, (data: Obj) => Obj> = {};

export function migrate(json: Obj, fromVersion: number): Obj {
  let data = json;
  for (let v = fromVersion; v < CURRENT_VERSION; v++) data = migrations[v](data);
  return data;
}

// ---------- ③' 既定値 ----------

/**
 * 同じ version の中で後から追加した項目の既定値。
 * 項目を「足すだけ」で、既存の項目の意味や形が変わらない場合は version を上げずにここで補う。
 *   ・purchased（第4回）: 購入済みの商品ID。ない場合は「何も購入していない」＝ []
 */
export function applyDefaults(json: Obj): Obj {
  return json.purchased === undefined ? { ...json, purchased: [] } : json;
}

// ---------- ④ 検証 ----------

function productProblem(v: unknown): string | null {
  if (!isObj(v)) return '形式が正しくありません';
  if (!isStr(v.id) || !ID_PATTERNS.product.test(v.id)) return `商品IDが正しくありません（${String(v.id)}）`;
  if (!isNonEmptyStr(v.name)) return '品目がありません';
  if (!isStr(v.category)) return 'カテゴリが正しくありません';
  if (!isNum(v.unitAmount) || v.unitAmount <= 0) return '基準数量が正しくありません';
  if (!isStr(v.unit)) return '単位が正しくありません';
  if (!(v.targetUnitPrice === null || (isNum(v.targetUnitPrice) && v.targetUnitPrice >= 0))) return '目安単価が正しくありません';
  if (!isOptStr(v.maker) || !isOptStr(v.memo) || !isOptBool(v.archived)) return 'メーカー・メモ・使用停止の形式が正しくありません';
  return null;
}

function storeProblem(v: unknown): string | null {
  if (!isObj(v)) return '形式が正しくありません';
  if (!isStr(v.id) || !ID_PATTERNS.store.test(v.id)) return `店舗IDが正しくありません（${String(v.id)}）`;
  if (!isNonEmptyStr(v.name)) return '店舗名がありません';
  if (!isOptStr(v.type) || !isOptStr(v.memo) || !isOptBool(v.archived)) return '種類・メモ・使用停止の形式が正しくありません';
  return null;
}

function recordProblem(v: unknown): string | null {
  if (!isObj(v)) return '形式が正しくありません';
  if (!isStr(v.id) || !ID_PATTERNS.record.test(v.id)) return `記録IDが正しくありません（${String(v.id)}）`;
  if (!isStr(v.date) || !isValidDate(v.date)) return `日付が正しくありません（${String(v.date)}）`;
  if (!isStr(v.productId) || !ID_PATTERNS.product.test(v.productId)) return '商品IDが正しくありません';
  if (!isStr(v.storeId) || !ID_PATTERNS.store.test(v.storeId)) return '店舗IDが正しくありません';
  if (!isNum(v.quantity) || v.quantity <= 0) return `販売数量が正しくありません（${String(v.quantity)}）`;
  if (!isNum(v.price) || v.price <= 0) return `販売価格が正しくありません（${String(v.price)}）`;
  if (!isOptBool(v.sale) || !isOptStr(v.note)) return 'セール・備考の形式が正しくありません';
  if (!isCount(v.seq)) return '登録順の番号が正しくありません';
  if (!isStr(v.createdAt) || !isOptStr(v.updatedAt)) return '登録日時が正しくありません';
  return null;
}

function checkList(label: string, list: unknown[], problem: (v: unknown) => string | null): string | null {
  for (let i = 0; i < list.length; i++) {
    const p = problem(list[i]);
    if (p) return `${label}の${i + 1}件目：${p}`;
  }
  return null;
}

function duplicate<T>(values: T[]): T | null {
  const seen = new Set<T>();
  for (const v of values) {
    if (seen.has(v)) return v;
    seen.add(v);
  }
  return null;
}

/** 現在の version の形式として正しいか。正しければ null、問題があれば理由 */
export function validateCurrent(json: Obj): string | null {
  const { products, stores, priceRecords, shoppingList, counters } = json;
  if (!Array.isArray(products)) return '商品データがありません';
  if (!Array.isArray(stores)) return '店舗データがありません';
  if (!Array.isArray(priceRecords)) return '価格履歴がありません';
  if (!Array.isArray(shoppingList)) return '買い物リストがありません';
  if (!isObj(counters) || !isCount(counters.product) || !isCount(counters.store) || !isCount(counters.record)) {
    return 'ID管理情報（counters）が正しくありません';
  }

  const problem =
    checkList('商品データ', products, productProblem) ??
    checkList('店舗データ', stores, storeProblem) ??
    checkList('価格履歴', priceRecords, recordProblem);
  if (problem) return problem;

  const ps = products as Product[];
  const ss = stores as Store[];
  const rs = priceRecords as PriceRecord[];
  let dup: unknown;
  if ((dup = duplicate(ps.map((p) => p.id)))) return `商品ID「${dup}」が重複しています`;
  if ((dup = duplicate(ss.map((s) => s.id)))) return `店舗ID「${dup}」が重複しています`;
  if ((dup = duplicate(rs.map((r) => r.id)))) return `価格記録ID「${dup}」が重複しています`;
  if ((dup = duplicate(rs.map((r) => r.seq)))) return `価格記録の登録順の番号（${dup}）が重複しています`;

  // 価格履歴が存在しない商品・店舗を指していないか（IDで紐付けているため、ここが壊れると集計できない）
  const productIds = new Set(ps.map((p) => p.id));
  const storeIds = new Set(ss.map((s) => s.id));
  const orphanP = rs.find((r) => !productIds.has(r.productId));
  if (orphanP) return `価格記録 ${orphanP.id} の商品「${orphanP.productId}」が商品データにありません`;
  const orphanS = rs.find((r) => !storeIds.has(r.storeId));
  if (orphanS) return `価格記録 ${orphanS.id} の店舗「${orphanS.storeId}」が店舗データにありません`;
  const badItem = shoppingList.find((id) => !isStr(id) || !productIds.has(id));
  if (badItem !== undefined) return `買い物リストの商品「${String(badItem)}」が商品データにありません`;

  const { purchased } = json;
  if (!Array.isArray(purchased)) return '購入済みの情報（purchased）が正しくありません';
  const badPurchased = purchased.find((id) => !isStr(id) || !productIds.has(id));
  if (badPurchased !== undefined) return `購入済みの商品「${String(badPurchased)}」が商品データにありません`;
  return null;
}

// ---------- ⑤ 取り出し ----------

/** 検証済みのデータから AppData の項目だけを取り出す（バックアップの app・exportedAt などは含めない） */
function normalize(json: Obj): AppData {
  const { products, stores, priceRecords, shoppingList, purchased, counters } = json as unknown as AppData;
  // 購入済みは買い物リストにある商品だけを残す（リストから外した商品のチェックは意味を持たないため。重複も除く）
  const listed = new Set(shoppingList);
  return structuredClone({
    version: CURRENT_VERSION,
    products,
    stores,
    priceRecords,
    shoppingList,
    purchased: [...new Set(purchased)].filter((id) => listed.has(id)),
    counters: { product: counters.product, store: counters.store, record: counters.record },
  });
}

/** 読み込み済みのJSON値を ②〜⑤ に通す */
export function loadAppData(json: unknown): ParseResult {
  const v = readVersion(json);
  if (!v.ok) return v;
  const migrated = applyDefaults(migrate(json as Obj, v.version));
  const problem = validateCurrent(migrated);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, data: normalize(migrated) };
}

/** 文字列（localStorage の値・バックアップファイルの中身）を ①〜⑤ に通す */
export function parseAppData(raw: string): ParseResult {
  const j = parseJson(raw);
  if (!j.ok) return j;
  return loadAppData(j.json);
}

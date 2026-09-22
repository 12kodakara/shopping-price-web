import { localDateString } from '../lib/date';
import {
  hasErrors,
  priceInputErrors,
  productInputErrors,
  storeInputErrors,
  type PriceInput,
  type ProductInput,
  type StoreInput,
} from '../lib/validation';
import { createSampleData } from './mockData';
import { loadAppData, parseAppData, parseJson } from './schema';
import type { AppData, BackupFile, DataSummary, PriceRecord, Product, ProductId, Store, StoreId } from './types';

// データの読み書きの窓口。画面は localStorage を直接触らず、必ずここを経由する。
// 将来データベース（またはAPI）へ切り替える際は、このファイルの中身を差し替える。
//
// 保存方式: localStorage の1つのキーに、AppData 全体を1つのJSONとして保存する。
//   ・書き込みは「最新を読み直す → 変更 → 保存」の順で行い、別タブでの変更を上書きしにくくする
//   ・保存に失敗したら画面上のデータも変更しない（保存できたものだけが表示される）
//   ・読み込んだJSONが壊れていても自動削除はしない（「サンプルデータに戻す」を選んだ場合のみ、退避してから置き換える）
//   ・復元・サンプルに戻す直前のデータは UNDO_KEY に1段階だけ退避し、「1つ前の状態に戻す」で戻せる

export const STORAGE_KEY = 'shopping-price-web/v1';
/** 復元・サンプルに戻す直前のデータ（1段階だけ） */
export const UNDO_KEY = 'shopping-price-web/v1/undo';
/** 壊れていたデータを置き換えたときの退避先（壊れたデータは「元に戻す」対象にできないため別に残す） */
export const BACKUP_KEY_PREFIX = 'shopping-price-web/backup/';
/** 復元で読み込むファイルの上限（これより大きいファイルは誤選択とみなす） */
export const MAX_BACKUP_CHARS = 5 * 1024 * 1024;

/** localStorage と同じ使い方ができるもの（テストでは偽物を渡す） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** 保存量の表示用（localStorage にはある。なくても動く） */
  readonly length?: number;
  key?(index: number): string | null;
}

export type RepoStatus =
  /** 正常に localStorage へ保存できる */
  | { kind: 'ready'; seeded: boolean }
  /** 保存データが壊れていて読み込めない（データは消さずに残している） */
  | { kind: 'corrupt'; reason: string }
  /** localStorage が使えない環境。画面を閉じると入力内容は消える */
  | { kind: 'memory-only'; reason: string };

/** 「1つ前の状態に戻す」で戻せるデータの情報 */
export interface UndoInfo {
  savedAt: string;
  reason: 'restore' | 'reset';
  summary: DataSummary;
}

export interface RepoSnapshot {
  status: RepoStatus;
  /** corrupt のときは null */
  data: AppData | null;
  undo: UndoInfo | null;
}

interface UndoSlot {
  savedAt: string;
  reason: UndoInfo['reason'];
  /** 退避した時点の保存データ（JSON文字列） */
  raw: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** 同じ内容の価格記録がこの時間内に続けて登録されたら、二重登録とみなして保存しない */
export const DUPLICATE_WINDOW_MS = 3000;

export function summarize(data: AppData): DataSummary {
  const dates = data.priceRecords.map((r) => r.date).sort();
  return {
    products: data.products.length,
    archivedProducts: data.products.filter((p) => p.archived).length,
    stores: data.stores.length,
    archivedStores: data.stores.filter((s) => s.archived).length,
    priceRecords: data.priceRecords.length,
    shoppingList: data.shoppingList.length,
    purchased: data.purchased.length,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
  };
}

/** 文字列が占めるおおよそのバイト数（localStorage は1文字2バイトで数えるブラウザが多い） */
const approxBytes = (s: string) => s.length * 2;

function formatId(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(3, '0')}`;
}

/**
 * 次のIDを発番する。
 * 通し番号（counters）と既存IDの最大番号の大きい方 + 1 を使うため、
 * 削除したIDや、何らかの理由で通し番号より大きいIDが既にあっても重複・再利用しない。
 */
export function nextId(prefix: string, counter: number, existingIds: string[]): { id: string; counter: number } {
  let max = counter;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return { id: formatId(prefix, max + 1), counter: max + 1 };
}

type Mutation<T> = { data: AppData; value: T } | { error: string };

export function createRepository(storage: StorageLike | null, now: () => Date = () => new Date()) {
  const listeners = new Set<() => void>();
  /** localStorage が使えないときの退避先 */
  let memoryUndo: UndoSlot | null = null;
  let snapshot: RepoSnapshot = withUndo(loadData());

  function readUndoSlot(): UndoSlot | null {
    if (!storage) return memoryUndo;
    try {
      const raw = storage.getItem(UNDO_KEY);
      if (raw === null) return memoryUndo;
      const slot = JSON.parse(raw) as UndoSlot;
      return typeof slot?.raw === 'string' && typeof slot.savedAt === 'string' ? slot : null;
    } catch {
      return null;
    }
  }

  function undoInfo(): UndoInfo | null {
    const slot = readUndoSlot();
    if (!slot) return null;
    const parsed = parseAppData(slot.raw);
    return parsed.ok ? { savedAt: slot.savedAt, reason: slot.reason, summary: summarize(parsed.data) } : null;
  }

  function withUndo(s: Omit<RepoSnapshot, 'undo'>): RepoSnapshot {
    return { ...s, undo: undoInfo() };
  }

  function loadData(): Omit<RepoSnapshot, 'undo'> {
    if (!storage) return { status: { kind: 'memory-only', reason: 'このブラウザでは保存機能が使えません' }, data: createSampleData() };
    let raw: string | null;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      return { status: { kind: 'memory-only', reason: '保存データを読み込めませんでした' }, data: createSampleData() };
    }
    if (raw === null) {
      // 保存データがないときだけ、サンプルデータを投入する
      const data = createSampleData();
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        return { status: { kind: 'memory-only', reason: 'このブラウザでは保存できません' }, data };
      }
      return { status: { kind: 'ready', seeded: true }, data };
    }
    const parsed = parseAppData(raw);
    if (!parsed.ok) return { status: { kind: 'corrupt', reason: parsed.reason }, data: null };
    return { status: { kind: 'ready', seeded: false }, data: parsed.data };
  }

  function emit() {
    for (const l of listeners) l();
  }

  function setSnapshot(next: Omit<RepoSnapshot, 'undo'>) {
    snapshot = withUndo(next);
    emit();
  }

  const canPersist = () => storage !== null && snapshot.status.kind !== 'memory-only';

  /** 最新の保存データを読み直してから変更し、保存する */
  function mutate<T>(fn: (data: AppData) => Mutation<T>): Result<T> {
    if (snapshot.status.kind === 'corrupt') return { ok: false, error: '保存データが壊れているため、保存できません' };

    let base = snapshot.data as AppData;
    if (storage && snapshot.status.kind === 'ready') {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw !== null) {
          const parsed = parseAppData(raw);
          if (!parsed.ok) {
            setSnapshot({ status: { kind: 'corrupt', reason: parsed.reason }, data: null });
            return { ok: false, error: '保存データが壊れているため、保存できません' };
          }
          base = parsed.data;
        }
      } catch {
        return { ok: false, error: '保存データを読み込めませんでした' };
      }
    }

    const result = fn(structuredClone(base));
    if ('error' in result) return { ok: false, error: result.error };

    if (storage && snapshot.status.kind === 'ready') {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(result.data));
      } catch {
        return { ok: false, error: '保存に失敗しました（ブラウザの保存容量が不足している可能性があります）' };
      }
    }
    setSnapshot({ status: snapshot.status, data: result.data });
    return { ok: true, value: result.value };
  }

  /**
   * 保存データ全体を置き換える（復元・サンプルに戻す）。
   * 置き換える前に現在のデータを退避する。退避に失敗したら何も変更しない。
   */
  function replaceAll(next: AppData, reason: UndoInfo['reason']): Result<void> {
    const savedAt = now().toISOString();
    if (!canPersist()) {
      if (snapshot.data) memoryUndo = { savedAt, reason, raw: JSON.stringify(snapshot.data) };
      setSnapshot({ status: snapshot.status, data: next });
      return { ok: true, value: undefined };
    }
    const s = storage as StorageLike;
    try {
      const raw = s.getItem(STORAGE_KEY);
      if (raw !== null) {
        if (parseAppData(raw).ok) s.setItem(UNDO_KEY, JSON.stringify({ savedAt, reason, raw } satisfies UndoSlot));
        else s.setItem(`${BACKUP_KEY_PREFIX}${savedAt}`, raw); // 壊れたデータも消さずに残す
      }
    } catch {
      return { ok: false, error: '現在のデータを退避できなかったため、中止しました（保存容量が不足している可能性があります）' };
    }
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      return { ok: false, error: '保存に失敗したため、中止しました（現在のデータはそのままです）' };
    }
    setSnapshot({ status: { kind: 'ready', seeded: false }, data: next });
    return { ok: true, value: undefined };
  }

  function firstError(errors: object): string | null {
    return hasErrors(errors) ? Object.values(errors)[0] : null;
  }

  function buildRecord(base: { id: string; seq: number; createdAt: string; updatedAt?: string }, input: PriceInput): PriceRecord {
    return {
      id: base.id,
      date: input.date,
      productId: input.productId,
      storeId: input.storeId,
      quantity: input.quantity,
      price: input.price,
      ...(input.sale ? { sale: true } : {}),
      ...(input.note ? { note: input.note } : {}),
      seq: base.seq,
      createdAt: base.createdAt,
      ...(base.updatedAt ? { updatedAt: base.updatedAt } : {}),
    };
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): RepoSnapshot {
      return snapshot;
    },

    /** 別タブで変更されたときなどに読み直す */
    reload() {
      setSnapshot(loadData());
    },

    // ---------- 商品 ----------

    addProduct(input: ProductInput): Result<Product> {
      const err = firstError(productInputErrors(input));
      if (err) return { ok: false, error: err };
      return mutate<Product>((data) => {
        const { id, counter } = nextId('P', data.counters.product, data.products.map((p) => p.id));
        const product: Product = { id, ...input };
        data.products.push(product);
        data.counters.product = counter;
        return { data, value: product };
      });
    },

    /** 商品の内容を変更する。IDは変わらないので、価格履歴との紐付けは維持される */
    updateProduct(id: ProductId, input: ProductInput): Result<Product> {
      const err = firstError(productInputErrors(input));
      if (err) return { ok: false, error: err };
      return mutate<Product>((data) => {
        const index = data.products.findIndex((p) => p.id === id);
        if (index < 0) return { error: '商品が見つかりません' };
        // 使用停止の状態は保ったまま、入力項目だけを置き換える
        const product: Product = { ...data.products[index], ...input, id };
        data.products[index] = product;
        return { data, value: product };
      });
    },

    /** 使用停止（論理削除）/ 再開。価格履歴はそのまま残る */
    setProductArchived(id: ProductId, archived: boolean): Result<Product> {
      return mutate<Product>((data) => {
        const product = data.products.find((p) => p.id === id);
        if (!product) return { error: '商品が見つかりません' };
        if (archived) product.archived = true;
        else delete product.archived;
        return { data, value: product };
      });
    },

    /** 商品の削除。価格履歴が1件でもあれば削除しない（使用停止を使う） */
    deleteProduct(id: ProductId): Result<Product> {
      return mutate<Product>((data) => {
        const product = data.products.find((p) => p.id === id);
        if (!product) return { error: '商品が見つかりません' };
        const used = data.priceRecords.filter((r) => r.productId === id).length;
        if (used > 0) return { error: `価格履歴が${used}件あるため削除できません。使用停止にしてください` };
        data.products = data.products.filter((p) => p.id !== id);
        data.shoppingList = data.shoppingList.filter((pid) => pid !== id);
        data.purchased = data.purchased.filter((pid) => pid !== id);
        return { data, value: product };
      });
    },

    // ---------- 店舗 ----------

    addStore(input: StoreInput): Result<Store> {
      const err = firstError(storeInputErrors(input));
      if (err) return { ok: false, error: err };
      return mutate<Store>((data) => {
        const { id, counter } = nextId('S', data.counters.store, data.stores.map((s) => s.id));
        const store: Store = { id, ...input };
        data.stores.push(store);
        data.counters.store = counter;
        return { data, value: store };
      });
    },

    /** 店舗の内容を変更する。IDは変わらないので、価格履歴との紐付けは維持される */
    updateStore(id: StoreId, input: StoreInput): Result<Store> {
      const err = firstError(storeInputErrors(input));
      if (err) return { ok: false, error: err };
      return mutate<Store>((data) => {
        const index = data.stores.findIndex((s) => s.id === id);
        if (index < 0) return { error: '店舗が見つかりません' };
        const store: Store = { ...data.stores[index], ...input, id };
        data.stores[index] = store;
        return { data, value: store };
      });
    },

    setStoreArchived(id: StoreId, archived: boolean): Result<Store> {
      return mutate<Store>((data) => {
        const store = data.stores.find((s) => s.id === id);
        if (!store) return { error: '店舗が見つかりません' };
        if (archived) store.archived = true;
        else delete store.archived;
        return { data, value: store };
      });
    },

    /** 店舗の削除。価格履歴が1件でもあれば削除しない（使用停止を使う） */
    deleteStore(id: StoreId): Result<Store> {
      return mutate<Store>((data) => {
        const store = data.stores.find((s) => s.id === id);
        if (!store) return { error: '店舗が見つかりません' };
        const used = data.priceRecords.filter((r) => r.storeId === id).length;
        if (used > 0) return { error: `価格履歴が${used}件あるため削除できません。使用停止にしてください` };
        data.stores = data.stores.filter((s) => s.id !== id);
        return { data, value: store };
      });
    },

    // ---------- 価格記録 ----------

    addPriceRecord(input: PriceInput): Result<PriceRecord> {
      const err = firstError(priceInputErrors(input));
      if (err) return { ok: false, error: err };
      return mutate<PriceRecord>((data) => {
        if (!data.products.some((p) => p.id === input.productId)) return { error: '商品が見つかりません' };
        if (!data.stores.some((s) => s.id === input.storeId)) return { error: '店舗が見つかりません' };

        const createdAt = now();
        const last = data.priceRecords.reduce<PriceRecord | null>((a, r) => (!a || r.seq > a.seq ? r : a), null);
        if (
          last &&
          createdAt.getTime() - new Date(last.createdAt).getTime() < DUPLICATE_WINDOW_MS &&
          last.date === input.date &&
          last.productId === input.productId &&
          last.storeId === input.storeId &&
          last.quantity === input.quantity &&
          last.price === input.price &&
          Boolean(last.sale) === input.sale &&
          (last.note ?? '') === (input.note ?? '')
        ) {
          return { error: '同じ内容の価格が直前に登録されたため、二重登録を防止しました' };
        }

        const { id, counter } = nextId('R', data.counters.record, data.priceRecords.map((r) => r.id));
        const record = buildRecord({ id, seq: counter, createdAt: createdAt.toISOString() }, input);
        data.priceRecords.push(record);
        data.counters.record = counter;
        return { data, value: record };
      });
    },

    /**
     * 価格記録の修正。ID・登録順（seq）・登録日時は変えない。
     * 単価・最新価格・最安などは保存せず、表示のたびに記録から計算するため、修正すると自動で反映される。
     */
    updatePriceRecord(id: string, input: PriceInput): Result<PriceRecord> {
      const err = firstError(priceInputErrors(input));
      if (err) return { ok: false, error: err };
      return mutate<PriceRecord>((data) => {
        const index = data.priceRecords.findIndex((r) => r.id === id);
        if (index < 0) return { error: '価格記録が見つかりません（別の画面で削除された可能性があります）' };
        if (!data.products.some((p) => p.id === input.productId)) return { error: '商品が見つかりません' };
        if (!data.stores.some((s) => s.id === input.storeId)) return { error: '店舗が見つかりません' };
        const { seq, createdAt } = data.priceRecords[index];
        const record = buildRecord({ id, seq, createdAt, updatedAt: now().toISOString() }, input);
        data.priceRecords[index] = record;
        return { data, value: record };
      });
    },

    /** 価格記録の削除（確認ダイアログを出すのは画面側の責任）。削除したIDは再利用しない */
    deletePriceRecord(id: string): Result<PriceRecord> {
      return mutate<PriceRecord>((data) => {
        const record = data.priceRecords.find((r) => r.id === id);
        if (!record) return { error: '価格記録が見つかりません（すでに削除されている可能性があります）' };
        data.priceRecords = data.priceRecords.filter((r) => r.id !== id);
        return { data, value: record };
      });
    },

    // ---------- 買い物リスト ----------

    /** 「今回買う」の追加・解除。リストから外した商品は購入済みのチェックも外す */
    setShoppingSelected(productId: ProductId, selected: boolean): Result<ProductId[]> {
      return mutate<ProductId[]>((data) => {
        if (!data.products.some((p) => p.id === productId)) return { error: '商品が見つかりません' };
        const set = new Set(data.shoppingList);
        if (selected) set.add(productId);
        else set.delete(productId);
        data.shoppingList = [...set];
        if (!selected) data.purchased = data.purchased.filter((id) => id !== productId);
        return { data, value: data.shoppingList };
      });
    },

    /** 複数の商品をまとめて買い物リストに追加する（すでにある商品はそのまま） */
    addAllToShoppingList(productIds: ProductId[]): Result<ProductId[]> {
      return mutate<ProductId[]>((data) => {
        const known = new Set(data.products.map((p) => p.id));
        const set = new Set(data.shoppingList);
        for (const id of productIds) if (known.has(id)) set.add(id);
        data.shoppingList = [...set];
        return { data, value: data.shoppingList };
      });
    },

    /** 買い物リストの商品を購入済み／未購入にする */
    setPurchased(productId: ProductId, purchased: boolean): Result<ProductId[]> {
      return mutate<ProductId[]>((data) => {
        if (!data.shoppingList.includes(productId)) return { error: 'この商品は買い物リストにありません' };
        const set = new Set(data.purchased);
        if (purchased) set.add(productId);
        else set.delete(productId);
        // 買い物リストの並び順に合わせる（表示の順番が変わらないように）
        data.purchased = data.shoppingList.filter((id) => set.has(id));
        return { data, value: data.purchased };
      });
    },

    /** すべて未購入に戻す（買い物リストの中身はそのまま） */
    resetPurchased(): Result<ProductId[]> {
      return mutate<ProductId[]>((data) => {
        data.purchased = [];
        return { data, value: data.purchased };
      });
    },

    // ---------- バックアップ・復元・初期化 ----------

    /** バックアップファイルの中身を作る（保存データが正常なときのみ） */
    createBackup(): Result<{ filename: string; json: string; summary: DataSummary }> {
      if (!snapshot.data) return { ok: false, error: '保存データが壊れているため、バックアップを作れません' };
      const at = now();
      const backup: BackupFile = { app: 'shopping-price-web', exportedAt: at.toISOString(), ...snapshot.data };
      return {
        ok: true,
        value: {
          filename: `shopping-price-backup-${localDateString(at)}.json`,
          json: JSON.stringify(backup, null, 2),
          summary: summarize(snapshot.data),
        },
      };
    },

    /** 復元の事前確認。ファイルの中身を検証して概要を返すだけで、保存データは一切変更しない */
    previewRestore(text: string): Result<{ data: AppData; summary: DataSummary; exportedAt: string | null }> {
      if (text.length > MAX_BACKUP_CHARS) return { ok: false, error: 'ファイルが大きすぎます。このアプリのバックアップファイルを選んでください' };
      const j = parseJson(text);
      if (!j.ok) return { ok: false, error: j.reason };
      const obj = j.json;
      if (typeof obj === 'object' && obj !== null && 'app' in obj && (obj as { app: unknown }).app !== 'shopping-price-web') {
        return { ok: false, error: 'このアプリのバックアップファイルではありません' };
      }
      const loaded = loadAppData(obj);
      if (!loaded.ok) return { ok: false, error: loaded.reason };
      const exportedAt = typeof (obj as { exportedAt?: unknown }).exportedAt === 'string' ? (obj as { exportedAt: string }).exportedAt : null;
      return { ok: true, value: { data: loaded.data, summary: summarize(loaded.data), exportedAt } };
    },

    /** 確認済みのデータで復元する。現在のデータは「1つ前の状態に戻す」用に退避する */
    restore(data: AppData): Result<void> {
      const checked = loadAppData(data);
      if (!checked.ok) return { ok: false, error: checked.reason };
      return replaceAll(checked.data, 'restore');
    },

    /**
     * サンプルデータに戻す（確認ダイアログを出すのは画面側の責任）。
     * 現在のデータは「1つ前の状態に戻す」用に退避する。壊れている場合は別のキーに残す。
     */
    resetToSample(): Result<void> {
      return replaceAll(createSampleData(), 'reset');
    },

    /** 復元・サンプルに戻す前の状態に戻す（1段階だけ） */
    undoReplace(): Result<void> {
      const slot = readUndoSlot();
      if (!slot) return { ok: false, error: '戻せるデータがありません' };
      const parsed = parseAppData(slot.raw);
      if (!parsed.ok) return { ok: false, error: `退避していたデータを読み込めません（${parsed.reason}）` };
      if (canPersist()) {
        try {
          (storage as StorageLike).setItem(STORAGE_KEY, JSON.stringify(parsed.data));
          (storage as StorageLike).removeItem(UNDO_KEY);
        } catch {
          return { ok: false, error: '保存に失敗しました（現在のデータはそのままです）' };
        }
        setSnapshot({ status: { kind: 'ready', seeded: false }, data: parsed.data });
      } else {
        memoryUndo = null;
        setSnapshot({ status: snapshot.status, data: parsed.data });
      }
      return { ok: true, value: undefined };
    },

    /** 保存データのJSON文字列（壊れている場合の書き出し用）。壊れていてもそのまま返す */
    exportRaw(): string | null {
      if (!storage) return snapshot.data ? JSON.stringify(snapshot.data, null, 2) : null;
      try {
        return storage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },

    /** このアプリが localStorage に保存しているおおよその量（バイト）。分からなければ null */
    storageUsage(): number | null {
      if (!canPersist()) return null;
      const s = storage as StorageLike;
      try {
        let total = 0;
        const keys: string[] = [];
        if (typeof s.length === 'number' && s.key) {
          for (let i = 0; i < s.length; i++) {
            const k = s.key(i);
            if (k && k.startsWith('shopping-price-web')) keys.push(k);
          }
        } else {
          keys.push(STORAGE_KEY, UNDO_KEY);
        }
        for (const k of keys) {
          const v = s.getItem(k);
          if (v !== null) total += approxBytes(k) + approxBytes(v);
        }
        return total;
      } catch {
        return null;
      }
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

function getBrowserStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = `${STORAGE_KEY}/probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** アプリ全体で使う repository */
export const repository: Repository = createRepository(typeof window === 'undefined' ? null : getBrowserStorage());

if (typeof window !== 'undefined') {
  // 別タブで保存されたら読み直す
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === UNDO_KEY || e.key === null) repository.reload();
  });
}

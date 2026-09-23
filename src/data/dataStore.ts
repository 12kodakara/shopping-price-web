import type { PriceInput, ProductInput, StoreInput } from '../lib/validation';
import type { Repository, RepoSnapshot, Result } from './repository';
import type { AppData, DataSummary, PriceRecord, Product, ProductId, Store, StoreId } from './types';

/**
 * 保存層（データの読み書き）の境界。
 *
 * 画面はこの形だけに依存する。現在の実装は localStorage 版（`createRepository`）だけで、
 * 第11回以降にクラウド同期版を作るときも、この形に合わせれば画面側を変えずに差し替えられる。
 *
 * このファイルは「型の定義」だけで、実行時には何もしない（ビルド結果にも残らない）。
 * 第10回の時点でアプリの動きは一切変わらない。設計の詳細は docs/cloud-sync-design.md を参照。
 */
export interface DataStore {
  // ---------- 読み取り・購読 ----------
  /** データが変わったら呼ばれる。戻り値を呼ぶと購読をやめる */
  subscribe(listener: () => void): () => void;
  /** 現在のデータと保存状態（壊れている・保存できない等） */
  getSnapshot(): RepoSnapshot;
  /** 保存先を読み直す（別タブでの変更など） */
  reload(): void;

  // ---------- 商品 ----------
  addProduct(input: ProductInput): Result<Product>;
  updateProduct(id: ProductId, input: ProductInput): Result<Product>;
  setProductArchived(id: ProductId, archived: boolean): Result<Product>;
  deleteProduct(id: ProductId): Result<Product>;

  // ---------- 店舗 ----------
  addStore(input: StoreInput): Result<Store>;
  updateStore(id: StoreId, input: StoreInput): Result<Store>;
  setStoreArchived(id: StoreId, archived: boolean): Result<Store>;
  deleteStore(id: StoreId): Result<Store>;

  // ---------- 価格記録 ----------
  addPriceRecord(input: PriceInput): Result<PriceRecord>;
  updatePriceRecord(id: string, input: PriceInput): Result<PriceRecord>;
  deletePriceRecord(id: string): Result<PriceRecord>;

  // ---------- 買い物リスト ----------
  setShoppingSelected(productId: ProductId, selected: boolean): Result<ProductId[]>;
  addAllToShoppingList(productIds: ProductId[]): Result<ProductId[]>;
  setPurchased(productId: ProductId, purchased: boolean): Result<ProductId[]>;
  resetPurchased(): Result<ProductId[]>;

  // ---------- バックアップ・復元・初期化 ----------
  createBackup(): Result<{ filename: string; json: string; summary: DataSummary }>;
  previewRestore(text: string): Result<{ data: AppData; summary: DataSummary; exportedAt: string | null }>;
  restore(data: AppData): Result<void>;
  resetToSample(): Result<void>;
  undoReplace(): Result<void>;
  exportRaw(): string | null;
  /** この端末での保存量の目安（バイト）。分からなければ null */
  storageUsage(): number | null;
}

/**
 * 現在の localStorage 版（createRepository）が上の形を満たしているかを、コンパイル時に確認する。
 * 満たしていれば true 型、満たさなければ never 型になり、次の行で型エラーになる。
 */
type LocalStorageSatisfiesDataStore = Repository extends DataStore ? true : never;
const localStorageSatisfiesDataStore: LocalStorageSatisfiesDataStore = true;
void localStorageSatisfiesDataStore;

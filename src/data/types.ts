// データ型の定義。
// 将来データベースに移行してもこの形を保つ想定。
// 結合キーは必ず ID（productId / storeId）を使い、商品名・店舗名では結合しない。

/** 商品ID（例: "P001"）。商品名を変更しても価格履歴との紐付けが壊れないよう、内部識別子として使う */
export type ProductId = string;
/** 店舗ID（例: "S001"） */
export type StoreId = string;

export interface Product {
  id: ProductId;
  category: string;
  /** 品目（商品名） */
  name: string;
  /** 基準数量（比較単位の数量。例: 1） */
  unitAmount: number;
  /** 単位（例: "本", "kg", "個"） */
  unit: string;
  /** 目安単価（基準数量あたり。この価格以下なら買い）。未設定は null */
  targetUnitPrice: number | null;
  maker?: string;
  memo?: string;
  /** 使用停止（論理削除）。価格履歴は残したまま、登録・比較の対象から外す */
  archived?: boolean;
}

export interface Store {
  id: StoreId;
  name: string;
  type?: string;
  memo?: string;
  /** 使用停止（論理削除）。価格履歴は残したまま、登録・比較の対象から外す */
  archived?: boolean;
}

export interface PriceRecord {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  productId: ProductId;
  storeId: StoreId;
  /** 販売数量（単位での数量。例: 6本入りなら 6） */
  quantity: number;
  /** 販売価格（税込・円） */
  price: number;
  sale?: boolean;
  note?: string;
  /**
   * 登録順の通し番号（1から増える）。
   * 同じ日付の記録が複数あるときは seq が大きい方（後から登録した方）を「最新」とする。
   */
  seq: number;
  /** 登録日時（ISO 8601） */
  createdAt: string;
  /** 最後に修正した日時（ISO 8601）。修正していなければなし */
  updatedAt?: string;
}

/** ID発番用の通し番号。削除したIDを再利用しないよう、最後に発番した番号を保持する */
export interface IdCounters {
  product: number;
  store: number;
  record: number;
}

/** 現在のデータ形式のバージョン。形式を変えるときは上げて、schema.ts に移行処理を追加する */
export const CURRENT_VERSION = 1;

/** 保存データ全体（localStorage には、これを1つのJSONとして保存する） */
export interface AppData {
  version: typeof CURRENT_VERSION;
  products: Product[];
  stores: Store[];
  priceRecords: PriceRecord[];
  /** 買い物候補で「今回買う」を選んだ商品ID（＝今回の買い物リスト） */
  shoppingList: ProductId[];
  /**
   * 買い物リストのうち、お店で「購入済み」にチェックした商品ID。常に shoppingList の一部。
   * 第4回で追加。これより前の保存データ・バックアップにはないため、読み込み時に [] を補う（schema.ts）。
   */
  purchased: ProductId[];
  counters: IdCounters;
}

/** バックアップファイルの中身。AppData に、どのアプリのいつのバックアップかを示す情報を加えたもの */
export interface BackupFile extends AppData {
  app: 'shopping-price-web';
  exportedAt: string;
}

/** 件数の概要（データ管理画面・復元前の確認で表示） */
export interface DataSummary {
  products: number;
  archivedProducts: number;
  stores: number;
  archivedStores: number;
  priceRecords: number;
  shoppingList: number;
  /** 買い物リストのうち購入済みの件数 */
  purchased: number;
  /** 価格記録の最も古い日付・新しい日付 */
  firstDate: string | null;
  lastDate: string | null;
}

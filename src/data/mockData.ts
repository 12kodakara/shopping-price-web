import type { AppData, PriceRecord, Product, Store } from './types';

// サンプルデータ（初回起動時・「サンプルデータに戻す」で使用）。
// 商品・店舗・直近の価格は Excel版「買い物価格比較.xlsx」の内容に合わせている。
// 価格履歴画面の確認用に、Excel版にはない過去の価格記録（R001〜R005）を追加している。
// R006〜R010 が Excel版の価格入力シートにある記録。

export const mockProducts: Product[] = [
  { id: 'P001', category: '日用品', name: 'サランラップ', unitAmount: 1, unit: '本', targetUnitPrice: 430, maker: '旭化成', memo: '30cm×50m' },
  { id: 'P002', category: '日用品', name: 'クレラップ', unitAmount: 1, unit: '本', targetUnitPrice: 430, maker: 'クレハ', memo: '30cm×50m' },
  { id: 'P003', category: '日用品', name: 'ムシューダ クローゼット用', unitAmount: 1, unit: '個', targetUnitPrice: 200, maker: 'エステー', memo: '1年防虫タイプ' },
  { id: 'P004', category: '食品', name: 'つや姫', unitAmount: 1, unit: 'kg', targetUnitPrice: 600, memo: '精米' },
  { id: 'P005', category: '飲料', name: 'やさしい麦茶', unitAmount: 1, unit: '本', targetUnitPrice: 160, maker: 'サントリー', memo: '2L×6本' },
];

export const mockStores: Store[] = [
  { id: 'S001', name: 'コストコ', type: '会員制倉庫店', memo: 'まとめ買い向け' },
  { id: 'S002', name: 'イオン', type: 'スーパー' },
  { id: 'S003', name: 'ドン・キホーテ', type: 'ディスカウント' },
  { id: 'S004', name: 'トライアル', type: 'ディスカウント' },
  { id: 'S005', name: 'ドラッグストア', type: 'ドラッグストア' },
  { id: 'S006', name: 'ホームセンター', type: 'ホームセンター' },
  { id: 'S007', name: 'Amazon', type: 'ネット通販', memo: '送料に注意' },
  { id: 'S008', name: '楽天市場', type: 'ネット通販', memo: 'ポイント還元は備考へ' },
  { id: 'S009', name: 'ミスターマックス', type: 'ディスカウント' },
];

type SampleRecord = Omit<PriceRecord, 'id' | 'seq' | 'createdAt'>;

// 日付の古い順（＝登録した順とみなす）
const sampleRecords: SampleRecord[] = [
  // 履歴表示確認用の追加記録
  { date: '2026-08-30', productId: 'P005', storeId: 'S009', quantity: 6, price: 900 },
  { date: '2026-09-05', productId: 'P004', storeId: 'S004', quantity: 2, price: 1280 },
  { date: '2026-09-10', productId: 'P005', storeId: 'S002', quantity: 6, price: 1080 },
  { date: '2026-09-12', productId: 'P001', storeId: 'S002', quantity: 1, price: 458 },
  { date: '2026-09-15', productId: 'P005', storeId: 'S003', quantity: 6, price: 948, sale: true },
  // Excel版と同じ記録
  { date: '2026-09-21', productId: 'P001', storeId: 'S001', quantity: 6, price: 2598, note: '6本パック' },
  { date: '2026-09-21', productId: 'P002', storeId: 'S001', quantity: 4, price: 1698, note: '4本パック' },
  { date: '2026-09-21', productId: 'P003', storeId: 'S001', quantity: 10, price: 1998, note: '10パック' },
  { date: '2026-09-21', productId: 'P004', storeId: 'S001', quantity: 5, price: 2980, note: '5kg 精米' },
  { date: '2026-09-22', productId: 'P005', storeId: 'S009', quantity: 6, price: 840 },
];

export const mockPriceRecords: PriceRecord[] = sampleRecords.map((r, i) => ({
  ...r,
  id: `R${String(i + 1).padStart(3, '0')}`,
  seq: i + 1,
  createdAt: `${r.date}T12:00:00.000Z`,
}));

/** サンプルデータ一式を新しく作る（呼び出し側で書き換えても元データに影響しないようコピーする） */
export function createSampleData(): AppData {
  return structuredClone({
    version: 1,
    products: mockProducts,
    stores: mockStores,
    priceRecords: mockPriceRecords,
    shoppingList: [],
    purchased: [],
    counters: { product: mockProducts.length, store: mockStores.length, record: mockPriceRecords.length },
  } satisfies AppData);
}

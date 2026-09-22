// 大量データのテスト用生成器（性能確認・ページ分割のテスト専用。アプリ本体からは使わない）。
// 生成したデータは Node 上のテスト、または Playwright がテストごとに作る独立したブラウザ環境でだけ使い、
// 普段使いのブラウザの localStorage には触れない。
// 乱数は固定の種から作るので、何度実行しても同じデータになる。

export interface LargeDataOptions {
  products: number;
  stores: number;
  records: number;
  /** 使用停止にする商品の割合（0〜1） */
  archivedProductRatio?: number;
}

const BASE_NAMES = ['牛乳', '卵', '食パン', 'ティッシュ', '洗剤', 'トイレットペーパー', '米', '麦茶', 'コーヒー', 'シャンプー'];
const CATEGORIES = ['食品', '飲料', '日用品', '洗剤', '調味料'];
const UNITS = ['本', '個', '箱', 'kg', 'パック'];
const STORE_TYPES = ['スーパー', 'ドラッグストア', 'ディスカウント', 'ホームセンター', 'ネット通販'];

/** 再現性のある簡単な乱数（mulberry32） */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, width = 3) => String(n).padStart(width, '0');

export function largeData({ products, stores, records, archivedProductRatio = 0 }: LargeDataOptions) {
  const rnd = random(20260922);
  const productList = Array.from({ length: products }, (_, i) => {
    const n = i + 1;
    return {
      id: `P${pad(n)}`,
      category: CATEGORIES[i % CATEGORIES.length],
      name: `${BASE_NAMES[i % BASE_NAMES.length]} ${pad(n, 4)}`,
      unitAmount: 1,
      unit: UNITS[i % UNITS.length],
      targetUnitPrice: 100 + (i % 10) * 20,
      ...(i % 7 === 0 ? { maker: 'テストメーカー' } : {}),
      ...(archivedProductRatio > 0 && (i + 1) % Math.round(1 / archivedProductRatio) === 0 ? { archived: true } : {}),
    };
  });
  const storeList = Array.from({ length: stores }, (_, i) => ({
    id: `S${pad(i + 1)}`,
    name: `テスト店 ${pad(i + 1)}`,
    type: STORE_TYPES[i % STORE_TYPES.length],
  }));

  const start = Date.UTC(2025, 0, 1);
  const days = 630; // 2025-01-01 〜 2026-09-22 あたり
  const recordList = Array.from({ length: records }, (_, i) => {
    const n = i + 1;
    const product = productList[Math.floor(rnd() * products)];
    const date = new Date(start + Math.floor(rnd() * days) * 86400000).toISOString().slice(0, 10);
    const quantity = 1 + Math.floor(rnd() * 6);
    const unitPrice = (product.targetUnitPrice ?? 100) * (0.8 + rnd() * 0.4);
    return {
      id: `R${pad(n)}`,
      date,
      productId: product.id,
      storeId: storeList[Math.floor(rnd() * stores)].id,
      quantity,
      price: Math.max(1, Math.round(unitPrice * quantity)),
      seq: n,
      createdAt: `${date}T12:00:00.000Z`,
    };
  });

  return {
    version: 1 as const,
    products: productList,
    stores: storeList,
    priceRecords: recordList,
    shoppingList: [] as string[],
    purchased: [] as string[],
    counters: { product: products, store: stores, record: records },
  };
}

import type { AppData, Product, ProductId, StoreId } from '../data/types';
import { buildCompareRows, compareTargets } from './price';

// 買い物リスト（「今回買う」を選んだ商品）を、お店で見やすい形に組み立てる。
// 価格の計算は価格比較と同じ処理（buildCompareRows）を使い、ここでは並べ替えとまとめだけを行う。

export interface ShoppingItem {
  product: Product;
  /** 買う予定のお店（＝現在の最安店）。価格の記録がなければ null */
  storeId: StoreId | null;
  /** 最安単価。価格の記録がなければ null */
  unitPrice: number | null;
  /** 目安との差（マイナスなら安い） */
  targetDiff: number | null;
  /** 今も「目安単価以下」か（リストに入れた後に値上がりした場合は false） */
  isCandidate: boolean;
  purchased: boolean;
}

export interface ShoppingGroup {
  /** 店舗未定のグループは null */
  storeId: StoreId | null;
  items: ShoppingItem[];
}

export interface ShoppingProgress {
  total: number;
  purchased: number;
  remaining: number;
}

export function buildShoppingList(data: AppData): { groups: ShoppingGroup[]; progress: ShoppingProgress } {
  const targets = compareTargets(data);
  const rows = new Map(buildCompareRows(targets.products, targets.records).map((r) => [r.product.id, r]));
  const purchased = new Set<ProductId>(data.purchased);

  // 使用停止の商品は表示しない（リストのデータ自体は残す）
  const items: ShoppingItem[] = [];
  for (const id of data.shoppingList) {
    const row = rows.get(id);
    if (!row) continue;
    items.push({
      product: row.product,
      storeId: row.cheapest?.storeId ?? null,
      unitPrice: row.cheapest?.unitPrice ?? null,
      targetDiff: row.targetDiff,
      isCandidate: row.targetDiff !== null && row.targetDiff <= 0,
      purchased: purchased.has(id),
    });
  }

  // 店舗ごとにまとめる。店舗の並びは店舗一覧の順、店舗未定は最後。商品の並びはリストに入れた順のまま
  const storeOrder = new Map(data.stores.map((s, i) => [s.id, i]));
  const byStore = new Map<StoreId | null, ShoppingItem[]>();
  for (const item of items) {
    const list = byStore.get(item.storeId) ?? [];
    list.push(item);
    byStore.set(item.storeId, list);
  }
  const rank = (id: StoreId | null) => (id === null ? Number.MAX_SAFE_INTEGER : storeOrder.get(id) ?? Number.MAX_SAFE_INTEGER - 1);
  const groups = [...byStore.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([storeId, groupItems]) => ({ storeId, items: groupItems }));

  const done = items.filter((i) => i.purchased).length;
  return { groups, progress: { total: items.length, purchased: done, remaining: items.length - done } };
}

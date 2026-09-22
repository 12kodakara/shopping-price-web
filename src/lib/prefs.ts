import { useState } from 'react';

// 画面の表示設定（「購入済みを非表示」など）。保存データ（商品・価格など）とは別のキーに置き、
// バックアップの対象にも含めない。読み書きできない環境では既定値で動く。

const PREFIX = 'shopping-price-web/prefs/';

export function usePersistentFlag(name: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + name);
      return raw === null ? initial : raw === '1';
    } catch {
      return initial;
    }
  });

  function update(next: boolean) {
    setValue(next);
    try {
      window.localStorage.setItem(PREFIX + name, next ? '1' : '0');
    } catch {
      // 保存できなくても画面上の切り替えはそのまま使える
    }
  }

  return [value, update];
}

import { useSyncExternalStore } from 'react';

/** PC表示（サイドバーあり）かどうか。styles.css の切り替え幅（901px）と合わせる */
export const PC_QUERY = '(min-width: 901px)';

/**
 * 画面幅の条件に合っているか。幅が変わると再描画される。
 * PC用・スマホ用で中身が大きく違う一覧を、両方描画してCSSで片方を隠すのではなく、片方だけ描画するために使う。
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

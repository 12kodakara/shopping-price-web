import type { IconName } from '../components/Icon';

export interface NavItem {
  path: string;
  label: string;
  /** スマホ下部ナビでの短い表示名 */
  shortLabel: string;
  icon: IconName;
}

// 全ページの一覧（PCサイドバー・スマホのメニューで使用）
export const navItems: NavItem[] = [
  { path: '/', label: 'ホーム', shortLabel: 'ホーム', icon: 'home' },
  { path: '/products', label: '商品', shortLabel: '商品', icon: 'box' },
  { path: '/prices/new', label: '価格登録', shortLabel: '＋価格', icon: 'plus' },
  { path: '/compare', label: '価格比較', shortLabel: '比較', icon: 'scale' },
  { path: '/shopping', label: '買い物候補', shortLabel: '買い物', icon: 'cart' },
  { path: '/history', label: '価格履歴', shortLabel: '履歴', icon: 'chart' },
  { path: '/stores', label: '店舗', shortLabel: '店舗', icon: 'store' },
];

// データ管理（目立たない位置に置く: PCはサイドバー下部、スマホはメニュー下部）
export const settingsItem = { path: '/settings', label: 'データ管理' };

// スマホ下部ナビの5項目（中央が「＋価格」）
export const bottomNavPaths = ['/', '/products', '/prices/new', '/compare', '/shopping'];

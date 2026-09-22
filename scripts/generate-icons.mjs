// PWA 用の仮アイコンを生成する（node scripts/generate-icons.mjs）。
// 新しい依存パッケージを増やさないよう、テストで使っている Playwright（インストール済みの Microsoft Edge）で
// SVG を描画して PNG に保存する。正式なロゴができたら public/icons/ の画像を差し替えること。
//
// デザイン: 緑の背景に白い買い物カート（アプリ内のアイコンと同じ形）＋「仮」の表示。
// maskable 版は、端末ごとに丸や角丸に切り抜かれても欠けないよう、絵を中央の安全領域（直径80%）に収める。

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const GREEN = '#1f6f5c';
const CART = 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2';

function svg(size, { maskable }) {
  // 絵の大きさ: 通常は全体の 64%、maskable は安全領域に収まる 50%
  const art = size * (maskable ? 0.5 : 0.64);
  const scale = art / 24;
  const offset = (size - art) / 2;
  const wheel = (cx) => `<circle cx="${cx}" cy="20" r="1.3" fill="#fff" />`;
  const badge = size * (maskable ? 0.13 : 0.16);
  // 「仮」の札は右上（maskable は安全領域の内側）
  const bx = maskable ? size * 0.66 : size * 0.76;
  const by = maskable ? size * 0.34 : size * 0.24;
  const radius = maskable ? 0 : size * 0.18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${GREEN}" />
  <g transform="translate(${offset} ${offset - art * 0.04}) scale(${scale})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="${CART}" />
    ${wheel(9)}${wheel(17)}
  </g>
  <g transform="translate(${bx} ${by})">
    <rect x="${-badge / 2}" y="${-badge / 2}" width="${badge}" height="${badge}" rx="${badge * 0.22}" fill="#fff" />
    <text x="0" y="${badge * 0.3}" text-anchor="middle" font-family="Yu Gothic UI, Meiryo, sans-serif" font-weight="700"
      font-size="${badge * 0.78}" fill="${GREEN}">仮</text>
  </g>
</svg>`;
}

const targets = [
  { file: 'public/icons/icon-192.png', size: 192, maskable: false },
  { file: 'public/icons/icon-512.png', size: 512, maskable: false },
  { file: 'public/icons/icon-maskable-192.png', size: 192, maskable: true },
  { file: 'public/icons/icon-maskable-512.png', size: 512, maskable: true },
  // iPhone のホーム画面用（iOS は自動で角を丸めるので、切り抜かれても欠けない maskable と同じ配置にする）
  { file: 'public/icons/apple-touch-icon.png', size: 180, maskable: true },
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(t.size, t)}</body></html>`);
  await page.locator('svg').screenshot({ path: t.file, omitBackground: true });
  console.log('生成:', t.file);
}
await browser.close();

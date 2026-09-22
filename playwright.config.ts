import { defineConfig } from '@playwright/test';

// ブラウザの追加ダウンロードを避けるため、PCにインストール済みの Microsoft Edge を使用する
export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'msedge',
  },
  projects: [
    { name: 'pc', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'smartphone', use: { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true } },
    // PWA（Service Worker・オフライン起動）は本番ビルドでしか動かないので、ビルドしたものを preview で配信して確認する
    {
      name: 'pwa',
      testDir: 'tests/pwa',
      use: { baseURL: 'http://localhost:4173', viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
    },
    // GitHub Pages と同じく /shopping-price-web/ の下で配信したときの確認（公開先のパスに合わせたビルド）
    {
      name: 'pwa-pages',
      testDir: 'tests/pwa-pages',
      use: { baseURL: 'http://localhost:4373', viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
    { command: 'npm run build && npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 180000 },
    {
      command: 'npm run build:pages && npm run preview:pages',
      url: 'http://localhost:4373/shopping-price-web/',
      reuseExistingServer: true,
      timeout: 180000,
    },
  ],
});

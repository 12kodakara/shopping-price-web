import { defineConfig } from '@playwright/test';

// ブラウザの追加ダウンロードを避けるため、PCにインストール済みの Microsoft Edge を使用する
export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5373',
    channel: 'msedge',
  },
  projects: [
    { name: 'pc', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'smartphone', use: { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true } },
    // PWA（Service Worker・オフライン起動）は本番ビルドでしか動かないので、ビルドしたものを preview で配信して確認する
    {
      name: 'pwa',
      testDir: 'tests/pwa',
      use: { baseURL: 'http://localhost:4273', viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
    },
    // クラウド（Supabase）のログイン画面。テスト専用のダミー設定で起動し、通信はテスト側で差し替える
    {
      name: 'cloud',
      testDir: 'tests/cloud',
      use: { baseURL: 'http://localhost:5273', viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
    },
    // GitHub Pages と同じく /shopping-price-web/ の下で配信したときの確認（公開先のパスに合わせたビルド）
    {
      name: 'pwa-pages',
      testDir: 'tests/pwa-pages',
      use: { baseURL: 'http://localhost:4373', viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    { command: 'npm run dev:nocloud', url: 'http://localhost:5373', reuseExistingServer: false },
    { command: 'npm run dev:cloudmock', url: 'http://localhost:5273', reuseExistingServer: false },
    { command: 'npm run build:test && npm run preview', url: 'http://localhost:4273', reuseExistingServer: false, timeout: 180000 },
    {
      command: 'npm run build:pages && npm run preview:pages',
      url: 'http://localhost:4373/shopping-price-web/',
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
});

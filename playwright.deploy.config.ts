import { defineConfig } from '@playwright/test';

// 公開後の確認（npm run verify:deploy）。公開URLに対して tests/pwa-pages のテストを実行する。
//   例: DEPLOY_URL=https://12kodakara.github.io/shopping-price-web/ npm run verify:deploy
// Playwright はテストごとに新しいブラウザ環境を作るので、利用者の端末のデータには触れない。
const url = new URL(process.env.DEPLOY_URL ?? 'https://12kodakara.github.io/shopping-price-web/');
process.env.DEPLOY_URL = url.href;
process.env.PAGES_BASE = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;

// 手元のPCではインストール済みの Microsoft Edge、GitHub Actions では同梱の Chromium を使う
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/pwa-pages',
  reporter: 'list',
  workers: 1,
  retries: isCI ? 2 : 0,
  use: {
    baseURL: url.origin,
    ...(isCI ? {} : { channel: 'msedge' }),
    viewport: { width: 375, height: 740 },
    isMobile: true,
    hasTouch: true,
  },
});

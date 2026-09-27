import { defineConfig } from '@playwright/test';

// 使用するブラウザ
//   ・手元のPC : 追加ダウンロードを避けるため、インストール済みの Microsoft Edge を使う
//   ・GitHub Actions : Edge が無いので、Playwright 同梱の Chromium を使う（CI=true で自動的に切り替わる）
// どちらも同じ Chromium 系のため、確認できる内容は変わらない。
const isCI = !!process.env.CI;

/**
 * 実行するテストの種類を絞る（GitHub Actions で分割して動かすため）。
 *   PW_PROJECTS=cloud npx playwright test --project=cloud
 * 指定がなければ、これまでどおり全部を対象にする。
 * 指定した種類に必要なサーバーだけを起動するので、実行も速くなる。
 */
const wanted = (process.env.PW_PROJECTS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
const needs = (...names: string[]) => wanted.length === 0 || names.some((n) => wanted.includes(n));

export default defineConfig({
  testDir: 'tests/e2e',
  // CI では、ログを開かなくても結果が分かるように JSON も出す（scripts/ci-test-summary.mjs が要約する）
  reporter: isCI ? [['list'], ['json', { outputFile: 'test-results/results.json' }]] : 'list',
  // CI では一時的な遅延で落ちることがあるので、2回まで自動で再試行する
  retries: isCI ? 2 : 0,
  // CI のマシンは非力なので、同時実行数を抑えて安定させる
  workers: isCI ? 2 : undefined,
  // test.only の消し忘れを CI で検出する
  forbidOnly: isCI,
  // CI で何かが固まっても、10分で打ち切って結果を出す（ジョブ側の上限20分より短くして、要約を必ず残す）
  ...(isCI ? { globalTimeout: 10 * 60 * 1000 } : {}),
  use: {
    baseURL: 'http://localhost:5373',
    ...(isCI ? {} : { channel: 'msedge' }),
    // CI で落ちたときに原因を追えるように、失敗したテストだけ記録を残す
    ...(isCI ? { trace: 'retain-on-failure' as const, screenshot: 'only-on-failure' as const } : {}),
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
    // 開発サーバー。PWA のテストにも「開発サーバーでは Service Worker を登録しない」確認があるため必要
    ...(needs('pc', 'smartphone', 'pwa')
      ? [{ command: 'npm run dev:nocloud', url: 'http://localhost:5373', reuseExistingServer: false, timeout: 120000 }]
      : []),
    ...(needs('cloud')
      ? [{ command: 'npm run dev:cloudmock', url: 'http://localhost:5273', reuseExistingServer: false, timeout: 120000 }]
      : []),
    // 本番ビルドの配信。公開先パスのテストにも「別アドレスのデータは見えない」確認があるため必要
    ...(needs('pwa', 'pwa-pages')
      ? [{ command: 'npm run build:test && npm run preview', url: 'http://localhost:4273', reuseExistingServer: false, timeout: 300000 }]
      : []),
    ...(needs('pwa-pages')
      ? [
          {
            command: 'npm run build:pages && npm run preview:pages',
            url: 'http://localhost:4373/shopping-price-web/',
            reuseExistingServer: false,
            timeout: 300000,
          },
        ]
      : []),
  ],
});

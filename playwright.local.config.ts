import { defineConfig } from '@playwright/test';

// 手元の実設定（.env.local）で起動した開発サーバー（http://localhost:5173）を確認する。
// メールの送信はしない（実際のログインは利用者本人が行う）。
export default defineConfig({
  testDir: 'tests/locallive',
  reporter: 'list',
  workers: 1,
  use: { baseURL: 'http://localhost:5173', channel: 'msedge', viewport: { width: 375, height: 740 } },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 120000 },
});

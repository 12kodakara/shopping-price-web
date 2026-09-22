import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// 大量データでの表示時間の計測用（npm run perf:render）。スマホ幅だけで1つずつ順に実行する。
export default defineConfig({
  ...base,
  testDir: 'tests/perf',
  workers: 1,
  projects: base.projects?.filter((p) => p.name === 'smartphone'),
});

// 画面テストの結果を、GitHub Actions の「ジョブ要約」と「注釈」に書き出す。
//   node scripts/ci-test-summary.mjs [結果のJSON]
//
// 管理者権限がないとログを開けないため、失敗したテスト名・場所・メッセージを注釈として出し、
// 実行画面から原因を確認できるようにするためのもの。
// 秘密情報を載せないよう、出すのはテスト名・場所・エラーメッセージだけにする。

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'test-results/results.json';
const out = process.env.GITHUB_STEP_SUMMARY;

const ANSI = /\u001b\[[0-9;]*m/g;

/** 1行に切り詰める */
function oneLine(text, max = 200) {
  return String(text ?? '')
    .replace(ANSI, '')
    .split('\n')[0]
    .slice(0, max);
}

/** 先頭の数行をつなげる（どの操作で止まったかが分かるように） */
function head(text, count = 8, max = 600) {
  return String(text ?? '')
    .replace(ANSI, '')
    .split('\n')
    .slice(0, count)
    .join(' / ')
    .slice(0, max);
}

/** GitHub の注釈に載せられる形にする */
function escape(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function collect(suite, path = []) {
  const results = [];
  const title = [...path, suite.title].filter(Boolean);
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const last = test.results?.[test.results.length - 1];
      const location = last?.error?.location ?? spec.location;
      results.push({
        title: [...title, spec.title].join(' › '),
        status: last?.status ?? 'unknown',
        expected: test.expectedStatus ?? 'passed',
        error: oneLine(last?.error?.message),
        detail: head(last?.error?.message),
        where: location ? `${location.file}:${location.line}` : '',
        duration: last?.duration ?? 0,
      });
    }
  }
  for (const child of suite.suites ?? []) results.push(...collect(child, title));
  return results;
}

const lines = [];
if (!existsSync(file)) {
  lines.push('## 画面テストの結果', '', '結果ファイルがありません（途中で打ち切られた可能性があります）。');
  console.log('::warning title=画面テストの結果::結果ファイルがありません（途中で打ち切られた可能性があります）');
} else {
  const report = JSON.parse(readFileSync(file, 'utf-8'));
  const all = (report.suites ?? []).flatMap((s) => collect(s));
  const bad = all.filter((t) => t.status !== 'passed' && t.status !== 'skipped' && t.status !== t.expected);
  const slow = [...all].sort((a, b) => b.duration - a.duration).slice(0, 5);

  lines.push('## 画面テストの結果', '');
  lines.push(`- 実行 ${all.length} 件 / 失敗 ${bad.length} 件`);
  if (report.stats?.duration) lines.push(`- 所要時間 ${Math.round(report.stats.duration / 1000)} 秒`);
  lines.push('');

  if (bad.length > 0) {
    lines.push('### 失敗したテスト', '');
    for (const t of bad.slice(0, 30)) {
      lines.push(`- **${t.title}**（${t.status}）${t.where ? ` — ${t.where}` : ''}`);
      if (t.detail) lines.push(`  - ${t.detail}`);
    }
    lines.push('');

    // 実行画面の注釈としても出す（ログを開かなくても一覧で確認できる）
    for (const t of bad.slice(0, 8)) {
      const body = [t.where && `場所 ${t.where}`, t.detail || t.error || '（メッセージなし）'].filter(Boolean).join(' — ');
      console.log(`::error title=${escape(`${t.status}: ${t.title}`.slice(0, 120))}::${escape(body)}`);
    }
  }

  lines.push('### 時間のかかったテスト', '');
  for (const t of slow) lines.push(`- ${Math.round(t.duration / 1000)}秒 — ${t.title}`);

  const summary = `実行 ${all.length} 件 / 失敗 ${bad.length} 件。時間のかかった順: ${slow
    .map((t) => `${Math.round(t.duration / 1000)}秒 ${t.title}`)
    .join(' | ')}`;
  console.log(`::notice title=画面テストの結果::${escape(summary).slice(0, 900)}`);
}

const text = lines.join('\n');
if (out) appendFileSync(out, `${text}\n`);
console.log(text);

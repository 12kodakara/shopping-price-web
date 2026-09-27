// 画面テストの結果を、GitHub Actions の「ジョブ要約」に書き出す。
//   node scripts/ci-test-summary.mjs [結果のJSON]
//
// ログを開けなくても、どのテストが失敗したのかを要約から確認できるようにするためのもの。
// 秘密情報を載せないよう、出すのはテスト名とエラーの先頭1行だけにする。

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'test-results/results.json';
const out = process.env.GITHUB_STEP_SUMMARY;

/** 値や個人情報が混ざらないよう、短く切って1行にする */
function oneLine(text, max = 200) {
  return String(text ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '') // 色の指定を落とす
    .split('\n')[0]
    .slice(0, max);
}

function collect(suite, path = []) {
  const results = [];
  const title = [...path, suite.title].filter(Boolean);
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const last = test.results?.[test.results.length - 1];
      results.push({
        title: [...title, spec.title].join(' › '),
        status: last?.status ?? 'unknown',
        expected: test.expectedStatus ?? 'passed',
        error: oneLine(last?.error?.message),
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
      lines.push(`- **${t.title}**（${t.status}）`);
      if (t.error) lines.push(`  - ${t.error}`);
    }
    lines.push('');

    // 実行画面の注釈としても出す（ログを開かなくても一覧で確認できる）
    const escape = (v) => String(v).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    for (const t of bad.slice(0, 8)) {
      console.log(`::error title=${escape(`${t.status}: ${t.title}`.slice(0, 120))}::${escape(t.error || '（メッセージなし）')}`);
    }
  }

  lines.push('### 時間のかかったテスト', '');
  for (const t of slow) lines.push(`- ${Math.round(t.duration / 1000)}秒 — ${t.title}`);

  // 時間のかかったテストも注釈に出す（固まっている箇所の手がかりになる）
  const escapeNotice = (v) => String(v).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(
    `::notice title=画面テストの結果::${escapeNotice(
      `実行 ${all.length} 件 / 失敗 ${bad.length} 件。時間のかかった順: ` + slow.map((t) => `${Math.round(t.duration / 1000)}秒 ${t.title}`).join(' | '),
    ).slice(0, 900)}`,
  );
}

const text = lines.join('\n');
if (out) appendFileSync(out, `${text}\n`);
console.log(text);

// 公開する成果物に、秘密情報・個人データが混ざっていないか調べる。
//   node scripts/scan-build.mjs dist
// 見つかった値そのものは表示せず、ファイル名と種類だけを出す。
//
// 単語の一致ではなく「本物の鍵の形」で判定する。
// （アプリ側には「秘密キーを弾く」処理があり、ライブラリにも service_role という語が出てくるため、
//   単語で探すと誤検出して公開が止まってしまう）

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist';

const PATTERNS = [
  { name: '秘密鍵', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Supabase の Secret key', re: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'GitHub のトークン', re: /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'AWS のアクセスキー', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google の APIキー', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'OpenAI のキー', re: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'メールアドレス', re: /[A-Za-z0-9._%+-]+@(gmail|outlook|yahoo|icloud)\.[A-Za-z.]{2,}/ },
  { name: 'PC内のフォルダのパス', re: /[A-Z]:\\Users\\[A-Za-z0-9._-]+/ },
];

/** JWT（xxx.yyy.zzz）のうち、公開用でない役割のものを探す */
function findPrivilegedJwt(text) {
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf-8'));
      if (payload.role && payload.role !== 'anon') return `role=${payload.role} のキー`;
    } catch {
      // 読めないものは無視（ただのランダム文字列のことが多い）
    }
  }
  return null;
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

const problems = [];
for (const file of walk(root)) {
  if (/shopping-price-(backup|raw)-.*\.json$/.test(file)) {
    problems.push(`${file}: バックアップファイル`);
    continue;
  }
  if (/\.(png|jpg|jpeg|webp|ico|woff2?|ttf)$/i.test(file)) continue;
  const text = readFileSync(file, 'utf-8');
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) problems.push(`${file}: ${name}`);
  }
  const jwt = findPrivilegedJwt(text);
  if (jwt) problems.push(`${file}: ${jwt}`);
}

if (problems.length > 0) {
  console.error('::error::公開成果物に秘密情報・個人データらしきものがあります。公開を中止します。');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`OK: ${root} に秘密情報・個人データは含まれていません`);

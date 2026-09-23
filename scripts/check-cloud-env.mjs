// クラウド接続設定の「設定あり／なし」だけを確認する（値そのものは表示しない）。
//   node scripts/check-cloud-env.mjs
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const file = '.env.local';
if (!existsSync(file)) {
  console.log(`${file} がありません。`);
  process.exit(1);
}

const values = new Map();
for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) values.set(m[1], m[2].trim());
}

const url = values.get('VITE_SUPABASE_URL') ?? '';
const key = values.get('VITE_SUPABASE_PUBLISHABLE_KEY') || values.get('VITE_SUPABASE_ANON_KEY') || '';

const shape = (v) => {
  if (!v) return 'なし';
  if (v.startsWith('https://') && v.endsWith('.supabase.co')) return '設定あり（https://….supabase.co の形）';
  if (v.startsWith('https://')) return '設定あり（https で始まる）';
  return '設定あり（形式に注意: https で始まっていません）';
};
const keyShape = (v) => {
  if (!v) return 'なし';
  if (v.startsWith('sb_secret_')) return '⚠ 秘密キー（sb_secret_…）が入っています。公開用キーに入れ替えてください';
  if (v.startsWith('sb_publishable_')) return '設定あり（sb_publishable_… の形）';
  if (v.split('.').length === 3) {
    try {
      const role = JSON.parse(Buffer.from(v.split('.')[1], 'base64url').toString()).role;
      return role === 'anon' ? '設定あり（anon キーの形）' : `⚠ role=${role} のキーです。公開用キーに入れ替えてください`;
    } catch {
      return '設定あり（形式不明）';
    }
  }
  return '設定あり（形式不明）';
};

console.log('VITE_SUPABASE_URL      :', shape(url));
console.log('公開用キー             :', keyShape(key));

let tracked = '';
try {
  tracked = execSync('git ls-files .env.local', { encoding: 'utf-8' }).trim();
} catch {
  // git が使えない場合は無視
}
console.log('.env.local のGit追跡   :', tracked ? '⚠ 追跡されています（危険）' : 'されていない（安全）');
console.log('判定                   :', url && key && !keyShape(key).startsWith('⚠') && !shape(url).includes('注意') ? 'クラウド接続の設定は完了' : '未設定または要修正');

import { createHash } from 'node:crypto';
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 公開先のパス（base）
//   ・通常（npm run dev / build / preview、テスト）: '/'
//   ・GitHub Pages（https://<ユーザー名>.github.io/<リポジトリ名>/）:
//       npm run build -- --base=/<リポジトリ名>/   （.github/workflows/deploy.yml で指定）
// アプリ側は import.meta.env.BASE_URL でこの値を参照する（ルーター・Service Worker の登録先）。

/** public/ 以下のファイル（manifest・アイコン）を列挙する */
function listPublicFiles(dir = 'public'): string[] {
  let files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files = files.concat(listPublicFiles(path));
    else files.push(path);
  }
  return files;
}

/**
 * PWA 用のファイルを出力する（本番ビルドのときだけ）。
 *   ・dist/sw.js … pwa/sw.js の雛形に、公開先のパス・キャッシュするファイルの一覧・版番号を埋め込む。
 *     版番号は全ファイルの内容から作るハッシュなので、中身が1文字でも変われば新しい版として検出される。
 *   ・dist/manifest.webmanifest … start_url・scope・アイコンの場所を公開先のパスに合わせる（base が '/' なら変更なし）
 *   ・dist/404.html … index.html の複製。GitHub Pages で /products などを直接開いたときもアプリが起動するように
 * vite-plugin-pwa（依存パッケージ約340個）を入れずに済ませるための最小限の実装。
 */
function pwaPlugin(): Plugin {
  let base = '/';
  let outDir = 'dist';
  return {
    name: 'shopping-price-pwa',
    apply: 'build',
    configResolved(config) {
      base = config.base;
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256').update(base);
      const urls = [base, `${base}index.html`];
      for (const [fileName, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (fileName.endsWith('.map')) continue;
        if (fileName !== 'index.html') urls.push(`${base}${fileName}`);
        hash.update(fileName).update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const file of listPublicFiles().sort()) {
        urls.push(`${base}${relative('public', file).replaceAll('\\', '/')}`);
        hash.update(file).update(readFileSync(file));
      }
      const template = readFileSync('pwa/sw.js', 'utf-8');
      hash.update(template);
      const version = hash.digest('hex').slice(0, 12);
      const source = template
        .replace("const BASE = '__BASE__';", `const BASE = ${JSON.stringify(base)};`)
        .replace("const VERSION = '__VERSION__';", `const VERSION = '${version}';`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(urls)};`);
      // 埋め込みに失敗したまま出力すると、利用者の端末で壊れた Service Worker が動いてしまうので止める
      if (/'__(BASE|VERSION)__'|= __PRECACHE__/.test(source)) {
        this.error('pwa/sw.js の __BASE__ / __VERSION__ / __PRECACHE__ を置き換えられませんでした');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
    writeBundle() {
      // manifest の「/」で始まるパスを公開先のパスに合わせる
      const manifestPath = join(outDir, 'manifest.webmanifest');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const withBase = (path: string) => (path.startsWith('/') ? base + path.slice(1) : path);
      manifest.id = withBase(manifest.id);
      manifest.start_url = withBase(manifest.start_url);
      manifest.scope = withBase(manifest.scope);
      manifest.icons = manifest.icons.map((icon: { src: string }) => ({ ...icon, src: withBase(icon.src) }));
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  plugins: [react(), pwaPlugin()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4273, strictPort: true },
  test: {
    include: ['src/**/*.test.ts'],
  },
});

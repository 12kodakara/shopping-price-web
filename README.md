# 買い物価格比較 Web版

個人用の買い物価格比較表（Excel版「買い物価格比較.xlsx」）の Web 版。
現在は **第11回：クラウド同期の認証基盤（ログインのみ・データ同期はまだ）** まで対応。入力した内容はこのブラウザの localStorage に保存される（外部サーバーには送らない）。

## 起動

```bash
npm install      # 初回のみ
npm run dev      # http://localhost:5173
```

スマホ実機で確認する場合は `npm run dev -- --host` で起動し、表示された `Network:` のURLを同じWi-Fiのスマホで開く。

## テスト

```bash
npm test          # 計算ロジックの単体テスト（Vitest）
npm run test:e2e  # 画面・ナビゲーションのテスト（Playwright / インストール済みの Microsoft Edge を使用）
npm run build     # 型チェック + 本番ビルド
npm run perf        # 大量データでの計算時間（商品1,000・価格履歴5,000 など）
npm run perf:render # 大量データでの画面表示時間（結果は test-results/render-measure.txt）
npm run phone       # ビルドして、同じWi-Fiのスマホから見られるように配信（http://PCのIPアドレス:4173）
npm run icons       # 仮アイコン（public/icons/）を作り直す
npm run build:pages   # GitHub Pages と同じ /shopping-price-web/ の下で動くビルド（dist-pages/）
npm run preview:pages # その確認用サーバー（http://localhost:4373/shopping-price-web/）
npm run verify:deploy # 公開後の確認（公開URLに対して PWA・画面のテストを実行）
npm run dev:cloudmock # クラウド（ログイン画面）の動作確認用。テスト専用のダミー設定で起動する
```

## 構成

| 場所 | 役割 |
| --- | --- |
| `src/data/types.ts` | 商品・店舗・価格記録の型 |
| `src/data/mockData.ts` | サンプルデータ（初回起動時に投入。Excel版と同じ商品・店舗・価格） |
| `src/data/repository.ts` | データの読み書きの窓口（localStorage）。DB導入時はここを差し替える |
| `src/data/schema.ts` | 保存データ・バックアップの読み込み（version確認 → 移行 → 検証 → 取り出し） |
| `src/data/useAppData.ts` | 画面から保存データを使うためのフック |
| `src/lib/validation.ts` | 入力チェック |
| `src/lib/download.ts` | バックアップファイルのダウンロード |
| `src/components/RestorePanel.tsx` | バックアップからの復元（確認付き） |
| `src/components/PriceRecordEditor.tsx` | 価格記録の修正・削除 |
| `src/components/ArchiveControls.tsx` | 商品・店舗の使用停止・削除 |
| `src/lib/shopping.ts` | 買い物リストの組み立て（店舗ごと・進捗） |
| `src/lib/prefs.ts` | 画面の表示設定（購入済みを非表示など）の保存 |
| `src/components/ConfirmDialog.tsx` | ボタン文言を指定できる確認ダイアログ |
| `src/lib/search.ts` | 検索・絞り込みの判定（部分一致・期間） |
| `src/lib/useListFilter.ts` | 商品・店舗一覧の検索と状態フィルター |
| `src/components/ListFilter.tsx` | 検索欄・状態切り替え・件数・クリア・ページ移動の共通部品 |
| `src/lib/pagination.ts` | 一覧のページ分割（1ページ50件） |
| `src/lib/useMediaQuery.ts` | 画面幅に応じた表示の切り替え |
| `tests/fixtures/largeData.ts` | 大量データのテスト用生成器 |
| `docs/performance-round6.md` | 第6回の計測結果 |
| `docs/cloud-sync-design.md` | 第10回のクラウド同期 設計書（まだ未接続） |
| `src/cloud/` | クラウド接続（設定・Supabaseクライアント・ログイン） |
| `src/components/CloudSyncSection.tsx` | データ管理の「アカウント・クラウド同期」欄 |
| `.env.example` | クラウド接続に使う環境変数の見本（実値は入れない） |
| `src/data/dataStore.ts` | 保存層の境界（型のみ。将来のクラウド版の差し替え用） |
| `public/manifest.webmanifest` | PWA の設定（名前・アイコン・表示方法） |
| `public/icons/` | アプリのアイコン（仮） |
| `pwa/sw.js` | Service Worker の雛形（ビルド時に dist/sw.js になる） |
| `src/pwa/register.ts` | Service Worker の登録と更新の検出 |
| `src/components/UpdateNotice.tsx` | 「新しいバージョンがあります」の案内 |
| `src/components/DeviceStorageInfo.tsx` | データ管理の「この端末での保存」欄 |
| `src/lib/price.ts` | 単価・最安・目安との差・履歴の計算 |
| `src/layout/` | サイドバー（PC）／下部ナビ・メニュー（スマホ） |
| `src/pages/` | 7画面 |

商品は商品ID（P001〜）、店舗は店舗ID（S001〜）で結合し、名前では結合しない。

## URL

| 画面 | URL |
| --- | --- |
| ホーム | `/` |
| 商品 | `/products` |
| 価格登録 | `/prices/new`（`?product=P005` で商品を選択済みにできる） |
| 価格比較 | `/compare` |
| 買い物候補 | `/shopping` |
| 価格履歴 | `/history` |
| 店舗 | `/stores` |
| データ管理 | `/settings`（バックアップ・復元・1つ前に戻す・サンプルデータに戻す） |
| 価格記録の修正 | `/history?product=P005&edit=R010` |
| 全商品の価格記録を検索 | `/history?product=all` |

## 保存データ

- localStorage のキー `shopping-price-web/v1` に、商品・店舗・価格履歴・買い物リスト・ID通し番号をまとめて1つのJSONで保存する。
- 保存データがないときだけサンプルデータを投入する。既存データは上書きしない。
- データが壊れている場合は復旧画面を表示し、自動削除はしない。「サンプルデータに戻す」を実行すると、元のデータを `shopping-price-web/backup/<日時>` に退避してから置き換える。
- 復元・サンプルに戻す直前のデータは `shopping-price-web/v1/undo` に1段階だけ退避し、データ管理画面の「1つ前の状態に戻す」で戻せる。

## バックアップ

- データ管理画面の「バックアップを保存」で `shopping-price-backup-YYYY-MM-DD.json` を保存する。中身は保存データ（version・products・stores・priceRecords・shoppingList・counters）に `app` と `exportedAt` を加えたもの。
- 「バックアップから復元」はファイルを選んでも即座には上書きしない。内容を検証し、件数の比較を表示し、確認ダイアログの後に復元する。不正なファイルは理由を表示して拒否し、現在のデータは変更しない。

## データ形式の version を上げるとき

1. `src/data/types.ts` の `CURRENT_VERSION` を上げ、型を変更する。
2. `src/data/schema.ts` の `migrations` に「古い version → 1つ新しい version」の変換を追加する。
3. `validateCurrent` を新しい形式に合わせる。古いバックアップも読み込み時に自動で変換される。

## 削除と使用停止

- 価格記録は確認ダイアログの後に削除できる。
- 商品・店舗は、価格履歴が1件でもあれば削除できない。「使用停止」にすると、価格登録・価格比較・買い物候補から外れ、価格履歴は残る。
- 削除したIDは再利用しない。

## 買い物リスト（第4回）

- 買い物候補画面の上部が「今回の買い物リスト」。「今回買う」を押した商品が、最安店ごとにまとまって表示される（価格の記録がない商品は「店舗未定」）。
- 行のどこを押しても購入済み／未購入を切り替えられる。購入済みは取り消し線と薄い表示。
- 「購入済みを非表示」のスイッチと進捗（例: 3 / 8 購入済み）は、スクロールしても上に残る。
- 「すべて未購入に戻す」は確認ダイアログの後に実行する。リストの中身は残る。
- 購入済みは保存データの `purchased`（商品IDの配列）に保存する。第3回までのデータ・バックアップにはこの項目がないため、読み込み時に `[]` を補う（version は 1 のまま）。
- 「購入済みを非表示」の設定は `shopping-price-web/prefs/hide-purchased` に保存する（バックアップ対象外）。

## 検索・絞り込み（第5回）

- 商品：品目・カテゴリ・メーカー・メモ・商品IDを部分一致で検索。「使用中／使用停止／すべて」で切り替え（既定は使用中）。
- 店舗：店舗名・種類・メモ・店舗IDを部分一致で検索。商品と同じ切り替え。
- 価格履歴：商品の選択肢「すべての商品（記録を検索）」で全記録を表示。1つの検索欄で商品名・店舗名を検索し、開始日・終了日（その日を含む）で期間を絞り込める。開始日が終了日より後なら入れ替えて扱い、その旨を表示する。
- 検索は、前後の空白・英字の大文字小文字・全角英数字の違いを無視する。空白で区切ると、すべての語を含むものだけ（AND）。
- 検索条件は画面の一時的な状態で、保存データ・バックアップには含めない（データ形式の変更なし）。

## ページ分割（第6回）

- 商品・店舗・価格履歴の一覧は1ページ50件。「前へ」「次へ」と「2 / 10ページ」で移動する（ページ番号は並べない）。
- 処理の順番は「全データ → 検索・絞り込み → 並べ替え → ページ分割 → 表示」。検索は常に全件が対象。
- 検索語・使用中／使用停止・日付・クリアを変えると1ページ目に戻る。削除や使用停止でページがなくなったら、存在する最後のページを表示する。
- 件数は「全128件中 51〜100件」「120 / 500件（51〜100件目）」のように表示する。
- ページ番号は画面の一時的な状態で、保存データには含めない。
- 買い物候補（買い物リスト）はページ分割しない（お店で全体を続けて見られるように）。

## PWA（第7回）

### 仕組み
- `public/manifest.webmanifest` … アプリ名「買い物価格比較」、`display: standalone`（ホーム画面から開くとブラウザの枠なし）、アイコン 192px・512px（通常・maskable）。
- アイコンは仮（緑の背景に白いカート＋「仮」）。正式なロゴができたら `public/icons/` の画像を差し替える（`npm run icons` で作り直せる）。
- Service Worker は依存パッケージを増やさない自前の最小実装（`pwa/sw.js` と `vite.config.ts` の serviceWorkerPlugin）。本番ビルドでだけ登録し、`npm run dev` では登録しない。
- キャッシュするのはアプリ本体（HTML・JS・CSS・アイコン・manifest）だけ。データは今までどおり localStorage で、Service Worker は触らない。
  - ページの読み込み: 通信を優先し、つながらない・4秒以上かかるときはキャッシュから起動（オンラインなら常に最新版）
  - `/assets/`（ファイル名に内容のハッシュ入り）・アイコン: キャッシュを優先
- 更新: 新しい版は裏で準備するが自動では切り替えない。画面上部に「新しいバージョンがあります」を出し、「更新する」を押したときだけ切り替えて再読み込みする。切り替え時に古いキャッシュを削除する。ホーム画面から開いたままの場合も、1時間以上たってアプリに戻ったときに更新を確認する。

### HTTPS について
- Service Worker とアプリとしてのインストールは、**HTTPS か localhost** でしか動かない（ブラウザの決まり）。
- 開発中: `npm run build && npm run preview` で http://localhost:4173 を開けば、このPCのブラウザで PWA の動作（オフライン起動など）を確認できる。
- 同じWi-Fiのスマホから `http://PCのIPアドレス:4173` で開く方法（`npm run phone`）は HTTP なので、画面の確認はできるが、オフライン起動と Android でのインストールはできない。
- 本番で公開するときに必要なこと（今回は公開しない）:
  - HTTPS で配信する
  - サイトの一番上（`/`）に置く。サブフォルダ（例: `https://example.github.io/リポジトリ名/`）に置く場合は、`start_url`・`scope`・Vite の `base`・`sw.js` の登録先の変更が必要
  - どのURL（`/products` など）でも `index.html` を返す設定にする
  - `sw.js` はキャッシュさせない（`Cache-Control: no-cache`）。`manifest.webmanifest` は `application/manifest+json` で配信する

### データについての注意
- アプリとしてインストールしても、データは同じ端末・同じアドレスの localStorage のまま（形式・version は変わらない）。
- iPhone では、Safari で開いたときとホーム画面のアプリで開いたときのデータが別々になる。移すときは「バックアップを保存」→「バックアップから復元」。
- 開くアドレス（`http://192.168.x.x:4173`、将来の公開先など）が変わると、データも別になる。

## Web公開（第8回）

### 公開先
- GitHub Pages（無料）: `https://12kodakara.github.io/shopping-price-web/`
- `.github/workflows/deploy.yml` … main に push すると、単体テスト → 型チェック・ビルド → PWA 成果物と秘密情報の確認 → 公開 を自動で行う。
- 公開先はサイトの一番上ではなく `/<リポジトリ名>/` の下になるため、ビルド時に `--base=/<リポジトリ名>/` を指定する（workflow が自動で指定）。ルーター・Service Worker・manifest・アイコンはこの値に合わせて出力される。
- GitHub Pages は `/products` などを直接開くと 404.html を返すので、ビルド時に index.html と同じ中身の 404.html を作っている（アプリは表示される）。
- 検索エンジンに載せない設定（`noindex`）をしている。アクセス制限ではないので、URL を知っていればだれでも開ける（データは各自の端末にだけ保存されるので、他人のデータが見えることはない）。

### データについて
- データはブラウザの localStorage に保存され、**アドレス（origin）ごとに別**。開発用のアドレス（http://localhost:5173 など）で入力したデータは、公開サイトには自動では移らない。
- 移すときは、元のアドレスのデータ管理で「バックアップを保存」→ 公開サイトのデータ管理で「バックアップから復元」。
- 公開サイトを初めて開いたときは、サンプルデータ（商品5件）で始まる。
- `https://12kodakara.github.io` は、同じ GitHub アカウントのほかの Pages サイトと同じアドレス（origin）になる。保存データのキーは `shopping-price-web/…` で分けているので混ざらない。

### 公開前に手元で行うこと
```bash
npm test && npm run test:e2e   # 単体テスト・画面テスト（PWA とサブディレクトリ配信を含む）
git push                        # main に push すると自動で公開
npm run verify:deploy           # 公開後、公開URLに対して確認
```

## クラウド同期（第11回・ログインのみ）

- 現在の公開版は **クラウド未設定**。アプリはこれまでどおり localStorage だけで動き、外部への通信は一切ない（テストで確認済み）。
- 環境変数を設定したビルドでだけ、データ管理に「アカウント・クラウド同期」欄が有効になり、メールのリンク（Magic Link）でログイン・ログアウトできる。
- **ログインしても、商品・店舗・価格履歴の送受信はまだ行わない**（同期は第13回以降）。

### 環境変数

| 名前 | 内容 | 公開 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase の Project URL | される（問題なし） |
| `VITE_SUPABASE_PUBLISHABLE_KEY`（または `VITE_SUPABASE_ANON_KEY`） | 公開用キー | される（RLS必須） |

- ローカルで試すときは `.env.local` に書く（Git には入らない）。見本は `.env.example`。
- `VITE_` で始まる値はビルド結果に埋め込まれ、誰でも読める。**service_role キーやDBのパスワードは絶対に設定しない**（設定された場合はアプリ側で検出し、クラウド機能を無効にする）。
- 本番（GitHub Pages）では、GitHub の Variables に登録してビルド時に渡す。

# クラウド同期 設計書（第10回・2026-09-23）

この文書は「PC・スマホ・別ブラウザでデータを共有する」ための調査と設計をまとめたもの。
**第10回の時点では、まだクラウドには一切つながっていない。** アプリは今までどおり localStorage だけで完全に動く。

---

## 1. 現状

### 1.1 保存しているもの（localStorage）

| キー | 中身 | 同期の要否 |
|---|---|---|
| `shopping-price-web/v1` | アプリのデータ全体（下表）を1つのJSONとして保存 | 要 |
| `shopping-price-web/v1/undo` | 「復元」「サンプルに戻す」の直前の状態（1段階） | 不要（端末ごと） |
| `shopping-price-web/backup/<日時>` | 壊れたデータを置き換えたときの退避 | 不要（端末ごと） |
| `shopping-price-web/prefs/hide-purchased` | 「購入済みを非表示」の設定 | 不要（端末ごと） |

`shopping-price-web/v1` の中身（`src/data/types.ts`）:

| 項目 | 形 | 主キー | 参照 | 日時 | 論理削除 | 省略可 |
|---|---|---|---|---|---|---|
| `version` | `1` | — | — | — | — | — |
| `products[]` | 商品 | `id`（`P001` 形式） | — | なし | `archived?: true` | `maker` `memo` `archived` |
| `stores[]` | 店舗 | `id`（`S001` 形式） | — | なし | `archived?: true` | `type` `memo` `archived` |
| `priceRecords[]` | 価格記録 | `id`（`R001` 形式） | `productId` → 商品 / `storeId` → 店舗 | `createdAt`（作成）、`updatedAt?`（修正） | なし（物理削除のみ） | `sale` `note` `updatedAt` |
| `shoppingList[]` | 買い物リスト（商品IDの配列） | — | 商品ID | なし | — | — |
| `purchased[]` | 購入済み（商品IDの配列。`shoppingList` の部分集合） | — | 商品ID | なし | — | — |
| `counters` | ID発番用の通し番号 `{product, store, record}` | — | — | — | — | — |

そのほかの性質:

- 価格記録には `seq`（登録順の通し番号）があり、同じ日付の記録の新旧はこれで決める。
- IDは端末内で連番。`counters` と既存IDの最大値から次の番号を決めるので、削除したIDは再利用しない。
- 書き込みは毎回「保存データ全体を読み直す → 変更 → 全体を書き戻す」方式（`src/data/repository.ts`）。
- 読み込みは必ず `src/data/schema.ts` の5段階（JSON読込 → version確認 → 移行 → 既定値補完 → 検証）を通る。
- 画面は localStorage を直接触らない。すべて `repository` 経由。
- データ量の目安: 商品1,000件・価格履歴5,000件で約814KB（計測値）。

### 1.2 クラウド同期で問題になりそうな箇所（監査結果）

| # | 問題 | 影響 | 対応方針 |
|---|---|---|---|
| 1 | 商品・店舗に更新日時がない | どちらの端末の変更が新しいか判定できない | 同期導入時に `updatedAt` を追加（データ形式 version 2） |
| 2 | 削除の記録が残らない（商品・店舗の物理削除、価格記録の削除） | 片方の端末で削除しても、もう片方から復活する | 削除済みの印（`deletedAt`）を残す方式に変更（tombstone） |
| 3 | IDが端末ごとの連番 | 2台で同時に商品を追加すると、同じ `P006` が別の商品になる | 同期導入時に「端末をまたいで衝突しないID」に切り替える（3.3） |
| 4 | `counters` が端末ごとに進む | 同上 | クラウド側では使わない。端末内の発番のみに使う |
| 5 | 保存が「全体を書き戻す」方式 | 1件の変更でも全件を送ることになる | クラウドへは「変更した行だけ」を送る（同期層を別に作る） |
| 6 | `shoppingList` / `purchased` が配列（順序と集合） | 2台で別々に足すと片方が消える | 集合として結合し、要素ごとに更新日時を持つ形に変更（3.2） |
| 7 | 買い物リストの「今回買う」は一時的な性質 | 端末間で同期すべきか迷う | 同期する（買い物中に端末を持ち替える場合に便利）。ただし優先度はB |
| 8 | 復元・サンプルに戻すは「全体の置き換え」 | クラウドと不整合になる | 同期中は「クラウド側も置き換える」明示操作として扱う（9.3） |

---

## 2. 課題

1. データが端末ごとに分かれていて、PCで登録した価格をスマホで見られない。
2. 移すには毎回 JSONバックアップ → 復元が必要で、日常利用には手間がかかる。
3. 端末を失うと、その端末のデータが失われる（バックアップを取っていなければ）。

---

## 3. 同期対象の分類

### 3.1 A: クラウド同期必須

- 商品（`products`）
- 店舗（`stores`）
- 価格記録（`priceRecords`）

### 3.2 B: 同期した方がよい

- 買い物リスト（`shoppingList`）と購入済み（`purchased`）
  - 買い物中に端末を持ち替える、家族で分担する、といった使い方で役に立つ。
  - 形は「商品IDごとに1行」（`shopping_items`）にして、要素ごとに更新日時を持たせる。

### 3.3 C: 端末ローカルでよい（同期しない）

- 検索文字・絞り込み・現在のページ（Reactの一時的な状態。そもそも保存していない）
- 「購入済みを非表示」の設定（`prefs/hide-purchased`）
- 「1つ前の状態に戻す」の退避（`v1/undo`）、壊れたデータの退避（`backup/<日時>`）
- `counters`（端末内のID発番用）
- Service Worker のキャッシュ

---

## 4. クラウド方式の比較

| 観点 | Supabase | Firebase (Firestore) | Cloudflare D1 + Workers | 自前サーバー（VPS等） |
|---|---|---|---|---|
| 無料枠 | DB 500MB・帯域5GB/月・認証5万MAU | 保存1GB・読み5万/日・書き2万/日 | D1 5GB・Workers 10万req/日 | なし（月数百円〜） |
| 個人利用との相性 | 良い | 良い | 良い | 過剰 |
| React/Vite | 公式JSライブラリ（`@supabase/supabase-js`） | 公式JSライブラリ | 自前でfetch | 自前 |
| GitHub Pages（静的配信） | そのまま使える（サーバー不要） | そのまま使える | Workers（別デプロイ）が必要 | サーバー必要 |
| 認証 | メールリンク・パスワード・Google等 | 同等 | 自前実装 | 自前実装 |
| DB | PostgreSQL（SQL） | ドキュメント型（NoSQL） | SQLite（SQL） | 自由 |
| アクセス制御 | Row Level Security（行単位のSQLルール） | セキュリティルール（独自言語） | Worker内で実装 | 自前 |
| バックアップ | 無料枠は自動バックアップなし（自分でエクスポート） | 有料機能中心 | 自分でエクスポート | 自前 |
| オフライン | 自前実装が必要 | ライブラリが標準対応（強み） | 自前実装 | 自前 |
| 複数端末同期 | 可（差分同期を自作） | 可（ほぼ自動） | 可（自作） | 可 |
| ベンダーロックイン | 小（標準SQL・データを持ち出しやすい） | 大（NoSQL・独自API） | 中 | なし |
| 実装難易度 | 中 | 中（同期は楽・データ設計は独特） | 大 | 大 |
| 保守性 | 良い（SQLとRLSだけ） | 普通（ルール言語の学習） | 普通 | 悪い（サーバー運用） |
| 注意点 | **無料プランは7日間まったくアクセスがないとプロジェクトが一時停止**（画面から再開操作が必要） | 従量課金（Blaze）へ移ると上限がなくなる。無料のままなら上限超過で停止 | 同期処理をすべて自作 | 費用と運用 |

補足:

- 料金・無料枠は各社の都合で変わる。ここに書いた数字は2026年9月時点の一般的な内容で、**契約前に必ず公式の料金ページを確認すること**。
- Firestore はオフラインと同期がほぼ自動で、実装量はいちばん少ない。一方でデータの形がNoSQLになり、いまのJSON（商品・店舗・価格記録の表形式）とは離れる。

---

## 5. 採用候補と理由

**採用候補: Supabase（PostgreSQL + Auth + Row Level Security）**

理由:

1. いまのデータが「商品・店舗・価格記録」という表形式で、SQLのテーブルにそのまま移せる。JSONバックアップとの対応も分かりやすい。
2. GitHub Pages のまま使える（サーバーを別に用意しなくてよい）。
3. アクセス制御を、フロントのコードではなくデータベース側のルール（RLS）で行える。公開されるJavaScriptに秘密情報を置かなくてよい。
4. データの持ち出しが簡単（SQLのエクスポート）。将来ほかの方式へ移りたくなったときの逃げ道がある。
5. 認証（メールリンク・Google）が最初から付いている。

Firestore を採用しない理由:

- オフライン同期が楽なのは魅力だが、データの形が変わり、いまのJSONバックアップ・検証・移行の仕組みを作り直すことになる。
- 今回の規模（1人・数千件）では、自作の差分同期でも十分間に合う。

**Supabase の注意点と対策**:

- 無料プランは7日間アクセスがないとプロジェクトが一時停止する。
  - 対策1: 週に1回以上アプリを使う（買い物用途なら通常は満たす）。
  - 対策2: GitHub Actions の定期実行（週1回）で、公開された `anon` キーを使って1件だけ読み取るだけの「生存確認」を行う。
  - 対策3: 一時停止しても、管理画面の「Restore」で数分で再開でき、データは消えない。
  - いずれにしても、**JSONバックアップを残す方針（12章）が最後の保険**になる。

---

## 6. 認証方式

| 方式 | 長所 | 短所 | 判定 |
|---|---|---|---|
| メールのリンク（Magic Link） | パスワード管理が不要。設定が最も簡単。スマホでも使いやすい | メールが届くまで待つ。迷惑メール対策が必要なことがある | **採用（第一候補）** |
| メール＋パスワード | オフラインでも入力できる。分かりやすい | パスワードの管理・再発行が必要 | 次点 |
| Googleログイン | 入力が速い。スマホと相性がよい | Google Cloud 側の設定（OAuth同意画面・リダイレクトURL登録）が必要 | 任意で後から追加 |
| GitHubログイン | 開発者には楽 | 家族と共有する場合に不向き | 不採用 |
| 認証なし（固定URL・固定キーでアクセス） | 実装が楽 | **URLやキーを知った人が全データを読み書きできる。GitHub Pages のJavaScriptは誰でも読めるため、事実上の公開になる** | **禁止** |

結論: **Supabase Auth のメールリンク（Magic Link）**。第11回で実装する。Googleログインは後から追加できる（同じユーザーに紐付けられる）。

---

## 7. DB schema 案

前提: 1行ごとに `user_id`（ログインした人のID）を持ち、RLSで自分の行だけを読み書きできるようにする。

```sql
-- 商品
create table public.products (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  id          text        not null,               -- 既存の商品ID（P001 形式）をそのまま使う
  category    text        not null default '',
  name        text        not null,
  unit_amount numeric     not null check (unit_amount > 0),
  unit        text        not null default '',
  target_unit_price numeric,                      -- null = 目安なし
  maker       text,
  memo        text,
  archived    boolean     not null default false, -- 使用停止（論理削除）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,                        -- 物理削除の代わりの印（tombstone）
  primary key (user_id, id)
);

-- 店舗
create table public.stores (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  id         text        not null,                -- S001 形式
  name       text        not null,
  type       text,
  memo       text,
  archived   boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- 価格記録
create table public.price_records (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  id         text        not null,                -- R001 形式
  date       date        not null,
  product_id text        not null,
  store_id   text        not null,
  quantity   numeric     not null check (quantity > 0),
  price      numeric     not null check (price > 0),
  sale       boolean     not null default false,
  note       text,
  seq        bigint      not null,                -- 同じ日付の新旧を決める登録順
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, product_id) references public.products(user_id, id),
  foreign key (user_id, store_id)   references public.stores(user_id, id)
);
create index price_records_sync_idx on public.price_records (user_id, updated_at);
create index price_records_product_idx on public.price_records (user_id, product_id, date desc);

-- 買い物リスト（商品1件につき1行）
create table public.shopping_items (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  product_id text        not null,
  purchased  boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,                         -- リストから外した印
  primary key (user_id, product_id),
  foreign key (user_id, product_id) references public.products(user_id, id)
);

-- 利用者ごとの設定・同期の管理情報
create table public.user_settings (
  user_id        uuid        not null primary key references auth.users(id) on delete cascade,
  data_version   integer     not null default 2,  -- アプリのデータ形式のversion
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

補足:

- `updated_at` は、データベース側のトリガーで自動更新するのではなく、**アプリが送った値をそのまま保存する**（端末の編集時刻で新旧を判定するため）。端末の時計がずれている場合に備え、同期時にサーバー時刻との差が大きければ警告を出す。
- 金額は `numeric`（小数の誤差が出ない型）。単価はアプリ側で計算する現在の方式を維持する（保存しない）。
- インデックスは「同期用（`updated_at`）」と「画面用（商品ごとの日付順）」の2本から始める。件数が増えたら追加を検討。

---

## 8. RLS（行単位のアクセス制御）とセキュリティ

```sql
alter table public.products       enable row level security;
alter table public.stores         enable row level security;
alter table public.price_records  enable row level security;
alter table public.shopping_items enable row level security;
alter table public.user_settings  enable row level security;

-- 5つのテーブルすべてに同じ形のポリシーを作る（例: products）
create policy "自分の行だけ読める" on public.products
  for select using (auth.uid() = user_id);
create policy "自分の行だけ追加できる" on public.products
  for insert with check (auth.uid() = user_id);
create policy "自分の行だけ更新できる" on public.products
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "自分の行だけ削除できる" on public.products
  for delete using (auth.uid() = user_id);
```

- `auth.uid()` はログインしている本人のIDで、**ブラウザ側から偽装できない**（サーバーがトークンを検証して決める）。`user_id` を送っても、本人以外の値は `with check` で拒否される。
- ブラウザに置くのは `anon`（公開用）キーだけ。これは公開前提のキーで、RLSと組み合わせて初めて安全になる。
- **`service_role` キー（すべての制限を無視できる管理用キー）は絶対にフロントエンドへ置かない。** GitHub にも置かない。
- XSS対策: このアプリは `innerHTML` や `eval` を使っていない（確認済み・0件）。外部スクリプトも読み込んでいない。ログイン情報（トークン）はブラウザに保存されるため、XSSが起きると盗まれうる。対策として、依存パッケージを増やさない方針を続け、必要なら `<meta http-equiv="Content-Security-Policy">` を追加する。
- GitHubへの秘密情報の混入対策: `.gitignore` に `.env*` を登録済み。GitHub Actions のビルドでも、成果物に秘密情報らしき文字列がないか検査している。
- 公開してよい値と、絶対に公開してはいけない値:

| 値 | 例 | 置き場所 | 公開可否 |
|---|---|---|---|
| プロジェクトURL | `VITE_SUPABASE_URL` | GitHub の Variables → ビルド時に埋め込み | 公開される（問題なし） |
| 公開キー | `VITE_SUPABASE_ANON_KEY` | 同上 | 公開される（RLS必須） |
| 管理キー | `SUPABASE_SERVICE_ROLE_KEY` | **使わない**（使うとしてもローカルのみ） | 絶対に公開しない |
| DBパスワード | — | Supabase管理画面のみ | 絶対に公開しない |

※ `VITE_` で始まる値は、ビルド結果のJavaScriptに埋め込まれ、誰でも読める。これは仕様どおりで、`anon` キーは公開前提。

---

## 9. localStorage との関係

### 9.1 役割

- **localStorage は今後も「その端末の正本（working copy）」として残す。** 画面はこれまでどおり localStorage を見て動くので、通信がなくても全機能が使える。
- クラウドは「端末間で合わせるための保管場所」。
- 同期層（新規）が、localStorage とクラウドの差分をやり取りする。

```
画面 ─ repository ─ localStorage（正本・オフラインでも動く）
                        │
                   同期層（新規・オンライン時のみ）
                        │
                    Supabase（各端末の合流点）
```

### 9.2 データ形式の変更（version 2）

同期を入れるには、1.2 の問題1〜3・6を解決する必要がある。第12回で次の変更を行う（**今回は変更しない**）。

| 追加・変更 | 理由 |
|---|---|
| 商品・店舗に `createdAt` / `updatedAt` | どちらが新しいか判定するため |
| 商品・店舗・価格記録に `deletedAt`（省略可） | 削除を端末間に伝えるため（tombstone） |
| `shoppingList` / `purchased` → `shoppingItems: [{productId, purchased, updatedAt, deletedAt?}]` | 要素ごとに新旧を判定するため |
| ID発番に端末ごとの接頭辞（例 `P-a1b2-006`）または UUID | 2台で同時に追加したときの衝突を防ぐため |
| `version: 2` | 上記のため |

- 既存の version 1 のデータ・バックアップは、読み込み時に自動で version 2 へ変換する（`src/data/schema.ts` の移行のしくみを使う。商品・店舗の `updatedAt` は移行時刻、`shoppingList`/`purchased` は配列から行に変換）。
- JSONバックアップの version は 2 になるが、**version 1 のバックアップは引き続き読み込める**。

### 9.3 ID の扱い（既存IDを捨てない）

- **既存の `P001` / `S001` / `R001` はそのまま残す。** クラウドの主キーも `(user_id, id)` なので、商品⇄価格記録⇄店舗の参照関係はそのまま移せる。
- 新しく作るIDだけ、端末をまたいで衝突しない形にする。候補:
  - 案A: 既存の形を保ったまま、端末ごとの短い接頭辞を足す（`P-7f3-006`）。既存データを書き換えないので安全。表示にも耐える。
  - 案B: UUID（`550e8400-...`）。衝突しないが、既存IDと形が混ざる。
  - **案Aを推奨**（既存IDに手を触れないため）。IDは内部識別子で、画面では商品名と並べて小さく表示しているだけなので、形が混ざっても実害は小さい。

---

## 10. 初回移行（localStorage → クラウド）

**自動では絶対に移行しない。** 次の手順を、利用者が明示的に進める形にする（第15回）。

1. ログイン（メールリンク）。
2. データ管理に「この端末のデータをクラウドへ移行」ボタンが出る。
3. 押すと、移行前の確認画面:
   - この端末の件数（商品○件・店舗○件・価格履歴○件・買い物リスト○件）
   - クラウド側の現在の件数（空なのか、すでにデータがあるのか）
   - 「クラウドが空なら、この端末の内容をそのまま登録します」
   - 「クラウドにすでにデータがある場合は、移行せずに『クラウドの内容を取り込む』を選んでください」
4. **移行の直前に、JSONバックアップの保存を促す**（ワンタップで保存。保存するまで次へ進めない設計も可）。
5. アップロード（1,000件ずつに分けて送る。途中で失敗したら中断し、部分的な状態を残さない）。
6. 件数の照合（商品・店舗・価格記録・買い物リストの件数と、IDの集合が一致するか）。
7. 一致したら「移行完了」。以後この端末は同期モードになる。
8. 2台目以降の端末は「クラウドの内容を取り込む」を選ぶ（その端末のローカルデータは、取り込み前にJSONバックアップを促す）。

失敗したときの扱い:

- どの段階で失敗しても、**localStorage のデータは変更しない**。
- 途中まで送った行は、次回の移行時に「同じIDは上書き」で解消する（同期の通常処理と同じ）。

---

## 11. オフライン戦略（設計のみ）

- localStorage が正本なので、**オフラインでも今までどおり全機能が使える**（現在と同じ）。
- 変更のたびに「送信待ち（outbox）」を localStorage に積む。
  - 例: `{ table: 'price_records', id: 'R011', op: 'upsert', updatedAt: '...' }`
  - 中身そのものではなく「どの行が変わったか」を積み、送るときに localStorage の最新値を読む（同じ行を何度も編集しても1回で済む）。
- オンラインに戻ったとき（`online` イベント、アプリを開いたとき、一定間隔）に:
  1. 送信待ちをまとめて送る（upsert）。
  2. 前回同期時刻以降に変わったクラウドの行を取得して取り込む。
  3. 同期時刻を更新する。
- 通信が不安定な場合に備え、1回の同期は1,000行単位に分割し、途中で失敗しても次回続きから行えるようにする（`updated_at` の昇順で進める）。
- Service Worker は今までどおりアプリ本体のキャッシュのみ。**データはキャッシュしない**（localStorage が担当）。

---

## 12. JSONバックアップ（継続）

- クラウド同期を入れた後も、**JSONバックアップ／復元は残す**。
- 理由: クラウドの事故（誤操作・アカウント喪失・サービス側の障害・無料プランの停止）に対する最後の保険。クラウドを唯一のバックアップにしない。
- 追加で検討すること:
  - バックアップに「どの利用者のデータか」「同期した時刻」を記録する（復元時の取り違えを防ぐ）。
  - 同期モードでの復元は「クラウド側も置き換える」明示操作として扱い、確認画面で件数の差を見せる。

---

## 13. 競合（同じデータを2台で編集したとき）

このアプリの規模では、**行単位の Last-Write-Wins（更新日時が新しい方を採用）** を基本とする。

| データ | 方針 | 理由 |
|---|---|---|
| 商品・店舗 | 行単位LWW（`updated_at` 比較） | 同じ商品を2台で同時に直すことは稀 |
| 価格記録 | 行単位LWW。IDが違えば両方残る | 新規登録が中心なので衝突しにくい |
| 買い物リスト（`shopping_items`） | 行単位LWW（「購入済み」も行の属性として比較） | 買い物中の持ち替えで自然な結果になる |
| 削除 | `deleted_at` も更新として扱う（削除の方が新しければ削除が勝つ） | 「消したのに復活する」を防ぐ |

- 同時刻（ミリ秒まで同じ）の場合は、端末IDの文字列比較で決める（どの端末から見ても同じ結果になるように）。
- **手動での競合解決画面は作らない**（1人利用では過剰）。ただし、LWWで負けた側の内容を失わないよう、同期で上書きされた行は端末内の履歴（最大50件）に残し、データ管理から確認できるようにする案を第16回で検討する。

---

## 14. 削除の同期

| 操作 | 現在 | 同期導入後 |
|---|---|---|
| 商品・店舗の「使用停止」 | `archived: true`（データは残る） | そのまま同期（`archived` 列） |
| 価格履歴のない商品・店舗の削除 | 物理削除 | `deleted_at` を立てて同期し、画面からは消す。一定期間（例: 90日）後にクラウドから完全削除 |
| 価格記録の削除 | 物理削除 | 同上 |
| サンプルデータに戻す | 全置き換え | 同期モードでは「クラウドも置き換える」明示操作（確認必須） |

- 「PCで使用停止 → スマホで復活」が起きないのは、`archived` も `updated_at` 付きの通常の更新として扱うため。新しい方が勝つ。
- 物理削除を tombstone に変えるため、「削除したIDを再利用しない」という現在の性質はそのまま維持される。

---

## 15. 同期状態の表示（設計のみ）

スマホの表示領域を圧迫しないこと。

- 上部の緑ヘッダーの右端に小さな丸（直径8px程度）を出す。
  - 緑 = 同期済み、点滅 = 同期中、灰色 = オフライン、オレンジ = 未同期あり、赤 = エラー
- 詳しい内容（最終同期時刻・未送信件数・エラー内容・「今すぐ同期」ボタン）は **データ管理の画面**にまとめる。
- エラー時だけ、画面上部に1行の帯（既存の「新しいバージョンがあります」と同じ形）を出す。
- 通常時は文字を出さない（常時表示のテキストは縦方向を圧迫するため）。

---

## 16. 費用の見込み

想定: 1人・端末2〜3台・商品数百〜1,000件・価格履歴数千〜数万件・1日あたり数十回の読み書き。

| 項目 | 使用量の見込み | Supabase無料枠 | 判定 |
|---|---|---|---|
| データベース容量 | 10〜20MB（価格履歴2万件でも数十MB） | 500MB | 余裕 |
| 帯域（転送量） | 月100MB未満 | 5GB | 余裕 |
| 認証の利用者数 | 1〜数人 | 5万MAU | 余裕 |
| API呼び出し | 1日数百回 | 上限なし（帯域で管理） | 余裕 |

- **月額0円で運用できる見込み。** 有料（Pro、月25ドル程度）が必要になるのは、容量・帯域を大きく超えるか、自動バックアップなどの機能が必要になった場合。
- 料金・無料枠は変更されることがあるため、契約時に公式ページで確認すること。
- 無料プランの一時停止（7日間無操作）への対策は5章のとおり。

---

## 17. GitHub Pages との関係

- **フロントエンドは GitHub Pages のままでよい。** Supabase はブラウザから直接呼ぶため、サーバーサイドの処理は不要。
- 必要な設定:
  - Supabase の「Site URL」と「Redirect URLs」に `https://12kodakara.github.io/shopping-price-web/` を登録（メールリンクの戻り先）。
  - GitHub の Variables に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を登録し、ビルド時に埋め込む（どちらも公開される値）。
- サーバーサイドが必要になる場合（今回は不要）: メール送信の独自化、管理者用の一括処理、秘密キーを使う処理。

---

## 18. 実装ロードマップ

各回の終わりに「今までどおり localStorage だけでも完全に動く」状態を保つ。クラウド機能は設定が入っているときだけ有効になる（機能フラグ）。

| 回 | 内容 | 完了条件 |
|---|---|---|
| 第11回 | Supabaseプロジェクト作成（利用者操作）＋ログイン画面（メールリンク）。データはまだ同期しない | ログイン・ログアウトができる。未ログインでも今までどおり使える |
| 第12回 | データ形式 version 2（更新日時・削除印・買い物リストの行化・ID衝突対策）＋移行処理＋テーブルとRLSのSQL | 既存データ・既存バックアップが自動で version 2 として読める。SQLは適用済みだが、まだ読み書きしない |
| 第13回 | 読み取り同期（クラウド → 端末）。まず「取り込むだけ」 | 別端末で入れたデータが取り込める。ローカルの変更は送らない |
| 第14回 | 書き込み同期（端末 → クラウド）。送信待ちの仕組み | 2台で相互に反映される。オフライン時は送信待ちに積まれる |
| 第15回 | 初回移行ウィザード（10章） | 件数照合まで含めて移行できる。失敗時はローカル無変更 |
| 第16回 | 競合・削除の同期・同期状態の表示・上書き履歴 | 2台同時編集・削除が想定どおりになる |
| 第17回 | iPhone／Android 実機確認、仕上げ | 実機でログイン・同期・オフラインを確認 |

---

## 19. ロールバック（元に戻す方法）

| 状況 | 戻し方 |
|---|---|
| クラウド機能をやめたい | 環境変数（`VITE_SUPABASE_*`）を外してビルドすると、ログイン機能ごと無効になり、完全にローカル保存だけのアプリに戻る |
| 同期の不具合でデータが壊れた | データ管理の「バックアップから復元」で戻す（クラウドに依存しない） |
| 直前の同期を取り消したい | 「1つ前の状態に戻す」（既存機能・1段階） |
| コードを戻したい | GitHub の該当コミットを revert して push（GitHub Actions が自動で再公開） |
| クラウド側を空にしたい | Supabase 管理画面でテーブルの行を削除、またはプロジェクトごと削除 |

---

## 20. 今回（第10回）行ったコード変更

- `src/data/dataStore.ts` を追加。保存層（現在は localStorage）の公開されている操作を型として書き出しただけのファイル。実行時の動きは一切変わらない。将来クラウド版を作るときに、同じ形をそなえているかをコンパイル時に確認できる。
- それ以外のコード・データ形式・保存方法は変更していない。

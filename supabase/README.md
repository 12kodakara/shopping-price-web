# Supabase（クラウド同期の保存先）

このフォルダには、Supabase 側に作るテーブルと安全設定（RLS）の SQL が入っています。
**秘密情報（Secret key・service_role キー・データベースのパスワード）は一切含みません。**

```
supabase/
  migrations/
    20260926000001_cloud_sync.sql   … テーブル・制約・RLS（何度実行しても同じ結果）
  verify-rls.sql                    … RLS が効いているかを確認する SQL
```

## 適用のしかた（Supabase の画面で行います）

1. https://supabase.com/dashboard を開き、プロジェクト **shopping-price** を選ぶ
2. 左のメニューの **SQL Editor**（紙とペンのアイコン）をクリック
3. **New query**（新しいクエリ）をクリック
4. `migrations/20260926000001_cloud_sync.sql` の中身を**すべてコピー**して貼り付ける
5. 右下の **Run**（または Ctrl+Enter）を押す
6. `Success. No rows returned` と出れば完了

> 何度実行しても同じ結果になります（既にある場合は作り直しません）。

## 正しく作られたかの確認

- 左メニューの **Table Editor** に `products` / `stores` / `price_records` / `shopping_items` / `user_settings` が並ぶ
- 各テーブルの右上に **RLS enabled** と表示される
- **Authentication → Policies** で、各テーブルに `_select_own` `_insert_own` `_update_own` `_delete_own` の4つが並ぶ

さらに詳しく確認するときは、SQL Editor で `verify-rls.sql` を実行してください。

## 使うキーについて

| キー | 使う場所 | このプロジェクトでの扱い |
|---|---|---|
| Project URL | ブラウザ | 公開前提。GitHub の Variables / `.env.local` |
| publishable（anon）key | ブラウザ | 公開前提。RLS で守る |
| **Secret key / service_role** | サーバー専用 | **使わない**（RLS を無視できるため、ブラウザに置くと全員のデータが読めてしまう） |
| DBパスワード | 直接接続用 | **使わない** |

-- ============================================================
-- 買い物価格比較 Web版 / 第12回 追加
-- テーブルを使う権限（GRANT）の付与
--
-- なぜ必要か
--   PostgreSQL では「テーブルを使ってよいか（GRANT）」と「どの行を見てよいか（RLS）」は別の仕組み。
--   RLS を設定しても、テーブル自体を使う権限が無いと `permission denied（42501）` で拒否される。
--   このプロジェクトでは権限が自動では付いていなかったため、ログインしていても件数を取得できなかった。
--
-- 方針
--   ・ログイン済み（authenticated）にだけ、5つのテーブルの読み書きを許可する。
--   ・どの行を扱えるかは、これまでどおり RLS（auth.uid() = user_id）で決まる。権限だけでは他人の行は見えない。
--   ・未ログイン（anon）には何も許可しない（明示的に取り消す）。
--   ・service_role は使わない方針のため、ここでは何も変更しない。
--
-- 何度実行しても同じ結果になります。
-- 適用方法: supabase/README.md を参照（Supabase の SQL Editor に貼り付けて実行）
-- ============================================================

-- スキーマを参照する権限（通常は付いているが、無い場合に備えて）
grant usage on schema public to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'stores', 'price_records', 'shopping_items', 'user_settings'] loop
    -- ログイン済みの利用者：読み書きできる（実際に扱える行は RLS が本人のものだけに限定する）
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    -- 未ログイン：一切許可しない（RLS と合わせて二重に遮断する）
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- 念のため、RLS が有効であることを再確認する（無効になっていたら有効に戻す）
alter table public.products       enable row level security;
alter table public.stores         enable row level security;
alter table public.price_records  enable row level security;
alter table public.shopping_items enable row level security;
alter table public.user_settings  enable row level security;

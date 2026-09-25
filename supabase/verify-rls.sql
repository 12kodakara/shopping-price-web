-- RLS（本人の行だけ読み書きできる設定）が効いているかの確認。
-- Supabase の SQL Editor に貼り付けて Run すると、確認結果が表で出ます。
-- データは変更しません（読み取りだけ）。

-- ① 5つのテーブルで RLS が有効か（rls_enabled がすべて true であること）
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('products', 'stores', 'price_records', 'shopping_items', 'user_settings')
order by c.relname;

-- ② ポリシーの一覧（各テーブルに select / insert / update / delete の4つ・条件が auth.uid() = user_id）
select
  tablename,
  policyname,
  cmd as command,
  roles,
  qual as using_condition,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('products', 'stores', 'price_records', 'shopping_items', 'user_settings')
order by tablename, cmd;

-- ③ 主キーに user_id が含まれているか（利用者どうしでIDが衝突しない設計になっているか）
select
  tc.table_name,
  tc.constraint_name,
  string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as primary_key
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'PRIMARY KEY'
  and tc.table_name in ('products', 'stores', 'price_records', 'shopping_items', 'user_settings')
group by tc.table_name, tc.constraint_name
order by tc.table_name;

-- ④ 未ログイン（anon）に権限が与えられていないか
--    ポリシーが authenticated 向けだけなので、anon では 0 行しか見えないのが正しい状態です。
select rolname as role, has_table_privilege(rolname, 'public.products', 'select') as can_select_products
from pg_roles
where rolname in ('anon', 'authenticated');

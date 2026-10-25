-- ============================================================
-- 買い物価格比較 Web版 / 第22回 追加
-- 商品テーブルに JANコードの列を足す
--
-- なぜ必要か
--   JANコードで商品を探せるようにしたので、探したコードを商品に覚えさせておくと
--   次回から探し直さずに済む。クラウド同期でもJANコードを引き継ぐために列が要る。
--
-- 方針
--   ・任意項目（null を許す）。これまでに登録した商品は何も変わらない。
--   ・8桁か13桁の数字だけを入れる。ただし既存の行は検査しない（not valid）ので、
--     この SQL を実行しても既存データが拒否されたり書き換わったりすることはない。
--   ・同じJANコードの商品を2つ登録することもあるため、一意制約は付けない。
--   ・商品画像のURLは保存しないため、列も作らない。
--
-- 何度実行しても同じ結果になります（既存データは変更しません）。
-- 適用方法: supabase/README.md を参照（Supabase の SQL Editor に貼り付けて実行）
-- ============================================================

alter table public.products
  add column if not exists jan text;

-- 形の検査。既存の行は見に行かない（not valid）ので、実行しても今のデータはそのまま
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_jan_format' and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_jan_format
      check (jan is null or jan ~ '^[0-9]{8}$' or jan ~ '^[0-9]{13}$')
      not valid;
  end if;
end $$;

comment on column public.products.jan is 'JANコード（8桁または13桁）。任意。第22回で追加';

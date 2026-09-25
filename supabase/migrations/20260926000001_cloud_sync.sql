-- ============================================================
-- 買い物価格比較 Web版 / 第12回
-- クラウド同期のテーブルと Row Level Security（RLS）
--
-- 方針
--   ・データの正本は今までどおり利用者の端末（localStorage）。ここは「同期先」。
--   ・すべての行に user_id を持たせ、本人の行だけ読み書きできるようにする（RLS）。
--   ・商品ID（P001）などは端末側の値をそのまま使う。利用者が違えば同じIDでも別の行になる
--     （主キーを (user_id, id) にしているため衝突しない）。
--   ・何度実行しても同じ結果になるように書いている（IF NOT EXISTS / DROP POLICY IF EXISTS）。
--
-- 適用方法: supabase/README.md を参照（Supabase の SQL Editor に貼り付けて実行）
-- ============================================================

-- ---------- 共通: updated_at を自動更新する ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- 商品 ----------
create table if not exists public.products (
  user_id           uuid        not null references auth.users (id) on delete cascade,
  id                text        not null,                    -- 端末側の商品ID（例: P001）
  category          text        not null default '',
  name              text        not null,
  unit_amount       numeric     not null,                    -- 基準数量
  unit              text        not null default '',
  target_unit_price numeric,                                 -- 目安単価（未設定は null）
  maker             text,
  memo              text,
  archived          boolean     not null default false,      -- 使用停止（論理削除）
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, id),
  constraint products_name_not_blank check (length(btrim(name)) > 0),
  constraint products_unit_amount_positive check (unit_amount > 0),
  constraint products_target_unit_price_positive check (target_unit_price is null or target_unit_price > 0)
);

-- ---------- 店舗 ----------
create table if not exists public.stores (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  id         text        not null,                           -- 端末側の店舗ID（例: S001）
  name       text        not null,
  type       text,
  memo       text,
  archived   boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint stores_name_not_blank check (length(btrim(name)) > 0)
);

-- ---------- 価格記録 ----------
-- 外部キーに user_id を含めることで、他人の商品・店舗を参照することが構造上できない。
create table if not exists public.price_records (
  user_id           uuid        not null references auth.users (id) on delete cascade,
  id                text        not null,                    -- 端末側の記録ID（例: R001）
  date              date        not null,
  product_id        text        not null,
  store_id          text        not null,
  quantity          numeric     not null,                    -- 販売数量
  price             numeric     not null,                    -- 販売価格（税込・円）
  sale              boolean     not null default false,
  note              text,
  seq               integer     not null,                    -- 端末側の登録順（同じ日付での新しさの判定に使う）
  recorded_at       timestamptz not null,                    -- 端末での登録日時（createdAt）
  record_updated_at timestamptz,                             -- 端末での最終修正日時（updatedAt。未修正は null）
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, product_id) references public.products (user_id, id) on delete cascade,
  foreign key (user_id, store_id) references public.stores (user_id, id) on delete cascade,
  constraint price_records_quantity_positive check (quantity > 0),
  constraint price_records_price_not_negative check (price >= 0),
  constraint price_records_seq_positive check (seq > 0)
);

create index if not exists price_records_user_product_idx on public.price_records (user_id, product_id);
create index if not exists price_records_user_date_idx on public.price_records (user_id, date);

-- ---------- 買い物リスト ----------
-- 端末側の shoppingList（今回買う）と purchased（購入済み）を1つの表で表す。
create table if not exists public.shopping_items (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  product_id text        not null,
  purchased  boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id),
  foreign key (user_id, product_id) references public.products (user_id, id) on delete cascade
);

-- ---------- 利用者ごとの設定 ----------
-- ID の発番番号（削除したIDを再利用しないための通し番号）と、データ形式の version を保持する。
create table if not exists public.user_settings (
  user_id         uuid        primary key references auth.users (id) on delete cascade,
  data_version    integer     not null default 1,
  counter_product integer     not null default 0,
  counter_store   integer     not null default 0,
  counter_record  integer     not null default 0,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint user_settings_counters_not_negative
    check (counter_product >= 0 and counter_store >= 0 and counter_record >= 0)
);

-- ---------- updated_at のトリガー ----------
do $$
declare
  t text;
begin
  foreach t in array array['products', 'stores', 'price_records', 'shopping_items', 'user_settings'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ============================================================
-- Row Level Security（本人の行だけ読み書きできるようにする）
--
--   ・未ログイン（auth.uid() が null）では、どの行も見えず、書き込みもできない。
--   ・user_id を他人のIDにして保存しようとしても with check で拒否される。
--   ・ブラウザで使うのは公開用キー（publishable / anon）だけ。
--     service_role キーは RLS を無視できるため、ブラウザ側では絶対に使わない。
-- ============================================================
alter table public.products       enable row level security;
alter table public.stores         enable row level security;
alter table public.price_records  enable row level security;
alter table public.shopping_items enable row level security;
alter table public.user_settings  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'stores', 'price_records', 'shopping_items', 'user_settings'] loop
    execute format('drop policy if exists "%s_select_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);

    execute format(
      'create policy "%s_select_own" on public.%I for select to authenticated using (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_insert_own" on public.%I for insert to authenticated with check (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_update_own" on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_delete_own" on public.%I for delete to authenticated using (auth.uid() = user_id)', t, t);
  end loop;
end;
$$;

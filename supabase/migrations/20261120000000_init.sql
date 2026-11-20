-- 髮型工作室預約系統：資料表
create extension if not exists btree_gist;

-- 店家設定（只有一列）
create table settings (
  id int primary key default 1 check (id = 1),
  shop_name text not null default '我的髮型工作室',
  designer_name text not null default '',
  address text not null default '',
  phone text not null default '',
  notice text not null default '',
  open_time time not null default '10:00',
  close_time time not null default '20:00',
  open_weekdays int[] not null default '{0,2,3,4,5,6}', -- 0=週日 … 6=週六
  slot_minutes int not null default 30,                 -- 可預約時段間隔
  days_ahead int not null default 30,                   -- 最多可預約幾天後
  min_notice_hours int not null default 2,              -- 至少提前幾小時預約
  auto_confirm boolean not null default false           -- true=客人預約後直接成立
);
insert into settings default values;

-- 公休日
create table closed_dates (
  date date primary key,
  note text not null default ''
);

-- 服務項目／價目表
create table services (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  duration_min int not null default 60,
  price int,
  price_note text not null default '',   -- 例如「起」「依髮長」
  sort int not null default 0,
  active boolean not null default true
);
insert into services (name, duration_min, price, price_note, sort) values
  ('剪髮', 60, 800, '', 1),
  ('染髮', 150, 2500, '起', 2),
  ('燙髮', 180, 3000, '起', 3),
  ('護髮', 60, 1200, '起', 4);

-- 客人
create table customers (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique,           -- 沒有 LINE 的客人（電話預約）可為空
  line_name text,
  picture_url text,
  name text not null default '',
  phone text not null default '',
  note text not null default '',      -- 髮質、過敏、喜好等
  created_at timestamptz not null default now()
);

-- 預約
create table bookings (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers on delete cascade,
  service_id bigint references services on delete set null,
  service_name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'done')),
  note text not null default '',
  created_by text not null default 'customer',
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  -- 同一時間不能有兩筆有效預約
  constraint no_overlap exclude using gist (
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('pending', 'confirmed'))
);
create index on bookings (start_at);
create index on bookings (customer_id);

-- 服務紀錄（配方、照片）
create table records (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers on delete cascade,
  booking_id bigint references bookings on delete set null,
  date date not null default (now() at time zone 'Asia/Taipei')::date,
  service text not null default '',
  formula text not null default '',   -- 染膏、藥水配方
  price int,
  note text not null default '',
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index on records (customer_id, date desc);

-- 作品集
create table portfolio (
  id bigint generated always as identity primary key,
  image_path text not null,
  title text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- 權限：公開資料任何人可看；其他資料只有登入的設計師能看
alter table settings enable row level security;
alter table closed_dates enable row level security;
alter table services enable row level security;
alter table portfolio enable row level security;
alter table customers enable row level security;
alter table bookings enable row level security;
alter table records enable row level security;

create policy "公開讀取" on settings for select to anon, authenticated using (true);
create policy "公開讀取" on closed_dates for select to anon, authenticated using (true);
create policy "公開讀取" on services for select to anon, authenticated using (true);
create policy "公開讀取" on portfolio for select to anon, authenticated using (true);

create policy "設計師管理" on settings for all to authenticated using (true) with check (true);
create policy "設計師管理" on closed_dates for all to authenticated using (true) with check (true);
create policy "設計師管理" on services for all to authenticated using (true) with check (true);
create policy "設計師管理" on portfolio for all to authenticated using (true) with check (true);
create policy "設計師管理" on customers for all to authenticated using (true) with check (true);
create policy "設計師管理" on bookings for all to authenticated using (true) with check (true);
create policy "設計師管理" on records for all to authenticated using (true) with check (true);

-- 照片空間：作品集公開、客人紀錄照片不公開
insert into storage.buckets (id, name, public) values
  ('portfolio', 'portfolio', true),
  ('records', 'records', false)
on conflict (id) do nothing;

create policy "設計師管理照片" on storage.objects for all to authenticated
  using (bucket_id in ('portfolio', 'records'))
  with check (bucket_id in ('portfolio', 'records'));

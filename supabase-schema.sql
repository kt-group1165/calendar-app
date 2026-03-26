-- カレンダーアプリ Supabase スキーマ
-- Supabaseのダッシュボード > SQL Editor で実行してください

-- eventsテーブル
create table if not exists events (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  color text not null default '#6366f1',
  all_day boolean not null default true,
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- updated_at自動更新トリガー
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger events_updated_at
  before update on events
  for each row execute function update_updated_at();

-- ストレージバケット（画像用）
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict do nothing;

-- ストレージポリシー（誰でも読み書き可能 ※ログインなしのため）
create policy "Public read" on storage.objects
  for select using (bucket_id = 'event-images');

create policy "Public upload" on storage.objects
  for insert with check (bucket_id = 'event-images');

create policy "Public delete" on storage.objects
  for delete using (bucket_id = 'event-images');

-- eventsテーブルのRLS（ログインなしでフルアクセス）
alter table events enable row level security;

create policy "Allow all" on events
  for all using (true) with check (true);

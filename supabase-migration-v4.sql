-- マイグレーション v4
-- Supabase SQL Editor で実行してください

-- メンバーにカラー追加
ALTER TABLE members ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#6366f1';

-- 予定に用件種別追加
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type text[] DEFAULT '{}';

-- 用件種別マスターテーブル
CREATE TABLE IF NOT EXISTS event_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all event_types" ON event_types;
CREATE POLICY "Allow all event_types" ON event_types
  FOR ALL USING (true) WITH CHECK (true);

-- デフォルト用件種別
INSERT INTO event_types (name, sort_order) VALUES
  ('納品', 1),
  ('回収', 2),
  ('書類受領', 3),
  ('選定', 4),
  ('モニタリング', 5),
  ('担当者会議', 6),
  ('契約', 7),
  ('家屋調査', 8)
ON CONFLICT (name) DO NOTHING;

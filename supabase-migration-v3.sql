-- マイグレーション v3
-- Supabase SQL Editor で実行してください

-- ソフトデリート（ゴミ箱）
ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 担当者（テキスト配列）
ALTER TABLE events ADD COLUMN IF NOT EXISTS assignees text[] DEFAULT '{}';

-- メンバーテーブル
CREATE TABLE IF NOT EXISTS members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all members" ON members
  FOR ALL USING (true) WITH CHECK (true);

-- 設定テーブル（マスターPINなど）
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all settings" ON settings
  FOR ALL USING (true) WITH CHECK (true);

-- デフォルトのマスターPIN（初回のみ。後でアプリから変更可能）
INSERT INTO settings (key, value) VALUES ('master_pin', '1234')
  ON CONFLICT (key) DO NOTHING;

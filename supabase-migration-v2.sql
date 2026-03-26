-- マイグレーション v2
-- Supabase SQL Editor で実行してください

-- eventsテーブルに作成者・編集者カラムを追加
ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_by text;

-- commentsテーブルを作成
CREATE TABLE IF NOT EXISTS comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  author text NOT NULL,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- commentsのRLS（ログインなしでフルアクセス）
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all comments" ON comments
  FOR ALL USING (true) WITH CHECK (true);

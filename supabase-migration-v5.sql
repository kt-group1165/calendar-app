-- マイグレーション v5
-- Supabase SQL Editor で実行してください

CREATE TABLE IF NOT EXISTS activity_logs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id        uuid,
  event_title     text NOT NULL,
  action          text NOT NULL,  -- 'created' | 'updated' | 'deleted' | 'comment_added'
  actor           text NOT NULL,
  assignees_before text[] DEFAULT '{}',
  assignees_after  text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all activity_logs" ON activity_logs;
CREATE POLICY "Allow all activity_logs" ON activity_logs
  FOR ALL USING (true) WITH CHECK (true);

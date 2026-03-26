-- Migration v7: member_groups テーブル追加

CREATE TABLE IF NOT EXISTS member_groups (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name         text NOT NULL,
  member_names text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE member_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all member_groups" ON member_groups;
CREATE POLICY "Allow all member_groups" ON member_groups
  FOR ALL USING (true) WITH CHECK (true);

-- v6: eventsテーブルにlocation（場所）カラムを追加
ALTER TABLE events ADD COLUMN IF NOT EXISTS location text;

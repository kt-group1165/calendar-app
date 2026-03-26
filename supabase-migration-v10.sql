-- Migration v10: events に notes（備考）カラム追加

ALTER TABLE events ADD COLUMN IF NOT EXISTS notes text;

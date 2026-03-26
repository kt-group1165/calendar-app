-- Migration v11: members に sort_order カラム追加

ALTER TABLE members ADD COLUMN IF NOT EXISTS sort_order integer;

-- 既存メンバーに名前順で sort_order を設定
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS rn
  FROM members
)
UPDATE members SET sort_order = ordered.rn
FROM ordered
WHERE members.id = ordered.id;

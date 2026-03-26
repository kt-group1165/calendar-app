-- Migration v8: image_urls 配列カラム追加（複数画像対応）

ALTER TABLE events ADD COLUMN IF NOT EXISTS image_urls text[] DEFAULT '{}';

-- 既存の image_url を image_urls に移行
UPDATE events
SET image_urls = ARRAY[image_url]
WHERE image_url IS NOT NULL
  AND image_url != ''
  AND (image_urls IS NULL OR image_urls = '{}');

-- =====================================================================
-- events.is_demo: デモ用 (プレゼン専用) 識別 flag
-- =====================================================================
-- 用途:
--   /fukuyogu-kanri-demo URL 用に「目標頻度ベースで水増しした」 events を
--   real events と区別するための flag。
--
--   - 本番 URL (/fukuyogu-kanri etc.): WHERE is_demo = false で除外
--   - デモ URL (/fukuyogu-kanri-demo): 全部表示 (is_demo フィルタなし)
--
--   visit-analytics の集計、calendar 描画、ゴミ箱、検索 etc 全ての events
--   read query は real tenant の場合「is_demo = false」を条件に追加する。
--
-- 物理設計:
--   - NOT NULL DEFAULT FALSE: 既存 row は自動的に false に埋まる。
--   - partial index (= is_demo=true のみ): デモ削除や seed 冪等チェックを高速化。
--
-- 実行方法: Supabase SQL Editor にこの 1 ブロックを貼り付けて Run
-- =====================================================================

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN events.is_demo IS
  'デモ用 (プレゼン専用) で水増しした event を識別する flag。real URL の query 側で WHERE is_demo = false を必ず追加する。';

-- demo event は数が少ない (=数百件想定) ので partial index で十分。
CREATE INDEX IF NOT EXISTS idx_events_is_demo_true
  ON events (start_date)
  WHERE is_demo = true;

COMMENT ON INDEX idx_events_is_demo_true IS
  'デモ event (is_demo=true) の月別カウント / 冪等チェック / 一括削除を高速化。';

COMMIT;

-- =====================================================================
-- 検証 (適用後)
-- =====================================================================
-- 1) 列追加確認:
--    SELECT column_name, data_type, column_default, is_nullable
--      FROM information_schema.columns
--     WHERE table_name = 'events' AND column_name = 'is_demo';
--    -> boolean / false / NO
--
-- 2) 既存 row が全て false か:
--    SELECT is_demo, COUNT(*) FROM events GROUP BY is_demo;
--    -> false: 全件 / true: 0
--
-- 3) partial index 確認:
--    SELECT indexname FROM pg_indexes
--     WHERE tablename = 'events' AND indexname = 'idx_events_is_demo_true';
-- =====================================================================

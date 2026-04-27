-- ============================================================
-- Migration v17: events に visit_type カラム追加
-- ============================================================
-- 目的:
--   訪問種別（ミーティング時訪問 / 個別訪問 / その他）の3択をテナント単位で
--   必須化できるようにする。
--   既存予定の NULL は維持（編集時にUI側で必須化するためDBレベルでは制約しない）。
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS visit_type TEXT;

-- 検索高速化（テナント単位で集計するケース用、省略可）
CREATE INDEX IF NOT EXISTS idx_events_visit_type ON events(tenant_id, visit_type)
  WHERE visit_type IS NOT NULL;

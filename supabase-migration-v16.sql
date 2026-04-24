-- ============================================================
-- Migration v16: 用件種別に「非表示」フラグ
-- ============================================================
-- 目的:
--   種別マスタを削除せずに一覧から隠せるようにする（ソフト非表示）。
--   削除と違い、既存の予定の event_type 配列はそのまま残せる。
--   管理パネル側で「非表示を表示」にチェックを入れると全件見える。
--   予定の種別選択ドロップダウン（EventModal）では常に hidden=false のみ表示。
-- ============================================================

ALTER TABLE event_types
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_event_types_hidden ON event_types(tenant_id, hidden);

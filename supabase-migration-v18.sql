-- ============================================================
-- Migration v18: 訪問種別を event_type に統合（v17の visit_type を撤回）
-- ============================================================
-- 目的:
--   visit_type 単独カラムをやめ、既存の event_types テーブルに3行
--   （ミーティング時訪問 / 個別訪問 / その他）を登録して同じ仕組みに統合する。
--   これにより用件種別フィルタが自動で機能する。
--
--   「その他」が選ばれたときの自由記述用に visit_other_detail カラムを新設。
--
-- 影響:
--   v17 で追加した events.visit_type を削除。データはまだほぼ無いので破棄可。
--   既存の visit_type_required_enabled 設定はそのまま流用（意味を「event_type に
--   3つのうち1つを必ず含める」に再定義）。
-- ============================================================

-- 1) v17 で追加した visit_type 関連を撤去
DROP INDEX IF EXISTS idx_events_visit_type;
ALTER TABLE events DROP COLUMN IF EXISTS visit_type;

-- 2) 「その他」用の自由記述カラムを追加
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS visit_other_detail TEXT;

-- 3) fukuyogu-kanri に3つの event_types を登録（既存があれば上書きしない）
--    sort_order は既存最大値+1から順に
DO $$
DECLARE
  v_max_sort INT;
BEGIN
  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort
    FROM event_types WHERE tenant_id = 'fukuyogu-kanri';

  INSERT INTO event_types (tenant_id, name, sort_order, office_id, hidden)
    VALUES
      ('fukuyogu-kanri', 'ミーティング時訪問', v_max_sort + 1, NULL, FALSE),
      ('fukuyogu-kanri', '個別訪問',           v_max_sort + 2, NULL, FALSE),
      ('fukuyogu-kanri', 'その他',             v_max_sort + 3, NULL, FALSE)
    ON CONFLICT DO NOTHING;
END $$;

-- 確認
-- SELECT * FROM event_types WHERE tenant_id = 'fukuyogu-kanri' ORDER BY sort_order;

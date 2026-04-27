-- ============================================================
-- Seed: 訪問種別 必須化（fukuyogu-kanri のみON）
-- ============================================================
-- 目的:
--   fukuyogu-kanri テナントだけ、予定作成・編集時に
--   「ミーティング時訪問 / 個別訪問 / その他」の選択を必須にする。
--   他テナントは未設定のままでOFF扱い（影響なし）。
--
-- 前提:
--   supabase-migration-v17.sql が先に実行されていること（events.visit_type 追加）
-- ============================================================

INSERT INTO settings (key, tenant_id, value)
  VALUES ('visit_type_required_enabled', 'fukuyogu-kanri', 'true')
  ON CONFLICT (key, tenant_id) DO UPDATE SET value = EXCLUDED.value;

-- 確認
-- SELECT * FROM settings WHERE key = 'visit_type_required_enabled';

-- ============================================================
-- Migration v14: event_types / clients に office_id を追加
-- ============================================================
-- 目的:
--   事業所別運用（自事業所切替）をメンバーだけでなく
--   用件種別・利用者にも拡張する。
--   NULL の行はテナント全体での共有データ（既存データの扱い）。
-- ============================================================

-- event_types.office_id
ALTER TABLE event_types
  ADD COLUMN IF NOT EXISTS office_id UUID REFERENCES offices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_types_office ON event_types(office_id);

-- clients.office_id
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS office_id UUID REFERENCES offices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_office ON clients(office_id);

-- ── 完了 ─────────────────────────────────────────────────
-- 既存行は office_id = NULL（= 共有扱い）
-- アプリ側で「自事業所 OR NULL」を表示する

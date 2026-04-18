-- ============================================================
-- Migration v15: エリア機能
-- ============================================================
-- 目的:
--   スタッフの「属性」ではなく、予定の「属性」としてエリアを管理。
--   事業所ごとにエリアを定義（A事業所の市原と B事業所の市原は別物）。
-- ============================================================

-- event_areas テーブル
CREATE TABLE IF NOT EXISTS event_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  office_id UUID REFERENCES offices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, office_id, name)
);

CREATE INDEX IF NOT EXISTS idx_event_areas_tenant ON event_areas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_areas_office ON event_areas(office_id);

-- events.area_id
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES event_areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_area ON events(area_id);

-- RLS（tenants テーブル同様、匿名も許可＋認証はテナント分離）
ALTER TABLE event_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_areas tenant access" ON event_areas;
CREATE POLICY "event_areas tenant access" ON event_areas FOR ALL
  USING (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()))
  WITH CHECK (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()));

-- 既存事業所に「市原 / 木更津 / その他」を自動投入
INSERT INTO event_areas (tenant_id, office_id, name, sort_order)
SELECT o.tenant_id, o.id, '市原', 1 FROM offices o
ON CONFLICT (tenant_id, office_id, name) DO NOTHING;

INSERT INTO event_areas (tenant_id, office_id, name, sort_order)
SELECT o.tenant_id, o.id, '木更津', 2 FROM offices o
ON CONFLICT (tenant_id, office_id, name) DO NOTHING;

INSERT INTO event_areas (tenant_id, office_id, name, sort_order)
SELECT o.tenant_id, o.id, 'その他', 3 FROM offices o
ON CONFLICT (tenant_id, office_id, name) DO NOTHING;

-- ── 完了 ─────────────────────────────────────────────────
-- 事業所がない場合、event_areas は空のまま（office_id NOT NULL 前提）

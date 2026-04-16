-- ============================================================
-- Migration v12: マルチテナント対応
-- ============================================================

-- テナントテーブル作成
CREATE TABLE IF NOT EXISTS tenants (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 各テーブルに tenant_id 列を追加（既存データは 'default' に）
ALTER TABLE events        ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE members       ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE clients       ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE member_groups ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE event_types   ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

-- settings テーブルの PK を (key, tenant_id) の複合キーに変更
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';
UPDATE settings SET tenant_id = 'default' WHERE tenant_id IS NULL;
ALTER TABLE settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE settings ADD PRIMARY KEY (key, tenant_id);

-- パフォーマンス用インデックス
CREATE INDEX IF NOT EXISTS idx_events_tenant_id        ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_members_tenant_id       ON members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_id       ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant_id ON activity_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_member_groups_tenant_id ON member_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_types_tenant_id   ON event_types(tenant_id);

-- 初期テナント登録（8チーム + default）
INSERT INTO tenants (id, name) VALUES
  ('default',            'デフォルト'),
  ('care-chiba',         'ケア・サポート千葉'),
  ('hana-mutsumi',       'Hanaムツミ福祉用具'),
  ('mutsumi-takashina',  '千葉ムツミ福祉用具高品'),
  ('sales-hq',           '統括営業本部'),
  ('links',              'リンクス福祉用具'),
  ('hana-hanamigawa',    'Hana福祉用具花見川'),
  ('honsha',             '本社'),
  ('test',               'テスト')
ON CONFLICT (id) DO NOTHING;

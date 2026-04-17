-- ============================================================
-- Migration v13: Supabase Auth 導入 + RLS テナント分離
-- ============================================================
-- Phase 1: 認証済みユーザーは厳密にテナント分離、匿名ユーザー(PINモード)は
--          従来通り許可する Dual-Mode RLS。Phase 2 で anon ブランチを削除予定。
-- ============================================================

-- ── 1. user_tenants テーブル新設 ──────────────────────────
-- auth.users と tenants の多対多。role と、既存 members への任意リンクを持つ。
CREATE TABLE IF NOT EXISTS user_tenants (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('master', 'member')),
  member_id  UUID REFERENCES members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tenants_user   ON user_tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_tenant ON user_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_member ON user_tenants(member_id);

-- ── 2. ヘルパー関数 ───────────────────────────────────────
-- user_tenants を参照するRLSでの循環参照を避けるため SECURITY DEFINER でラップ。
CREATE OR REPLACE FUNCTION auth_user_tenants()
RETURNS SETOF TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_master_tenants()
RETURNS SETOF TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role = 'master'
$$;

-- ── 3. 既存の "Allow all" ポリシー削除 ────────────────────
-- 名前が "Allow all" / "Allow all <table>" となっている既存ポリシーを除去。
DROP POLICY IF EXISTS "Allow all" ON events;
DROP POLICY IF EXISTS "Allow all members" ON members;
DROP POLICY IF EXISTS "Allow all settings" ON settings;
DROP POLICY IF EXISTS "Allow all event_types" ON event_types;
DROP POLICY IF EXISTS "Allow all comments" ON comments;
DROP POLICY IF EXISTS "Allow all member_groups" ON member_groups;
DROP POLICY IF EXISTS "Allow all activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "Allow all clients" ON clients;

-- ── 4. tenants テーブルの RLS ─────────────────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenants read" ON tenants;
DROP POLICY IF EXISTS "tenants master write" ON tenants;

CREATE POLICY "tenants read" ON tenants FOR SELECT
  USING (
    auth.uid() IS NULL
    OR id IN (SELECT auth_user_tenants())
  );

-- テナント自体の追加はマスターなら既存テナント外にも（初期セットアップ用）
CREATE POLICY "tenants insert" ON tenants FOR INSERT
  WITH CHECK (
    auth.uid() IS NULL
    OR EXISTS (SELECT 1 FROM auth_user_master_tenants() LIMIT 1)
  );

CREATE POLICY "tenants update delete" ON tenants FOR UPDATE
  USING (
    auth.uid() IS NULL
    OR id IN (SELECT auth_user_master_tenants())
  );

-- ── 5. user_tenants 自身の RLS ────────────────────────────
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_tenants self read" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants master manage" ON user_tenants;

-- 自分自身の行は見える
CREATE POLICY "user_tenants self read" ON user_tenants FOR SELECT
  USING (user_id = auth.uid());

-- 同テナントのmasterは全操作可能（SECURITY DEFINER関数で循環回避）
CREATE POLICY "user_tenants master manage" ON user_tenants FOR ALL
  USING (tenant_id IN (SELECT auth_user_master_tenants()))
  WITH CHECK (tenant_id IN (SELECT auth_user_master_tenants()));

-- ── 6. 共通ポリシー（Dual-Mode）──────────────────────────
-- 認証済み→自分のテナントのみ、匿名→従来通り全許可
-- events
CREATE POLICY "events tenant access" ON events FOR ALL
  USING (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()))
  WITH CHECK (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()));

-- members
CREATE POLICY "members tenant access" ON members FOR ALL
  USING (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()))
  WITH CHECK (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()));

-- clients
CREATE POLICY "clients tenant access" ON clients FOR ALL
  USING (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()))
  WITH CHECK (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()));

-- activity_logs
CREATE POLICY "activity_logs tenant access" ON activity_logs FOR ALL
  USING (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()))
  WITH CHECK (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()));

-- member_groups
CREATE POLICY "member_groups tenant access" ON member_groups FOR ALL
  USING (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()))
  WITH CHECK (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()));

-- event_types
CREATE POLICY "event_types tenant access" ON event_types FOR ALL
  USING (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()))
  WITH CHECK (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()));

-- settings
CREATE POLICY "settings tenant access" ON settings FOR ALL
  USING (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()))
  WITH CHECK (auth.uid() IS NULL OR tenant_id IN (SELECT auth_user_tenants()));

-- comments （comments テーブルは events を通じてテナントに紐づく。直接tenant_idを持たない想定）
-- events の tenant_id 経由で判定
DROP POLICY IF EXISTS "comments tenant access" ON comments;
CREATE POLICY "comments tenant access" ON comments FOR ALL
  USING (
    auth.uid() IS NULL
    OR event_id IN (
      SELECT id FROM events
      WHERE tenant_id IN (SELECT auth_user_tenants())
    )
  )
  WITH CHECK (
    auth.uid() IS NULL
    OR event_id IN (
      SELECT id FROM events
      WHERE tenant_id IN (SELECT auth_user_tenants())
    )
  );

-- ── 7. Storage バケットのポリシー（event-images）────────
-- 画像は署名URLではなく公開URLを使っているため、従来通りpublic read/writeを維持する。
-- 本番ではsigned URL化を検討すべきだが、Phase 1では現状維持。

-- ── 8. auth.users → user_tenants トリガー（招待受諾時の自動作成）──
-- サインアップ時のメタデータ `app_metadata.invite_tenant_id` に tenant_id を入れておけば
-- 自動で user_tenants 行が作られる。
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id TEXT;
  v_role      TEXT;
  v_member_id UUID;
BEGIN
  v_tenant_id := NEW.raw_app_meta_data->>'invite_tenant_id';
  v_role      := COALESCE(NEW.raw_app_meta_data->>'invite_role', 'member');
  v_member_id := (NEW.raw_app_meta_data->>'invite_member_id')::UUID;

  IF v_tenant_id IS NOT NULL THEN
    INSERT INTO user_tenants (user_id, tenant_id, role, member_id)
    VALUES (NEW.id, v_tenant_id, v_role, v_member_id)
    ON CONFLICT (user_id, tenant_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- ── 完了 ─────────────────────────────────────────────────
-- 実行後、以下を確認:
-- 1. SELECT * FROM user_tenants; → 空のテーブルが存在する
-- 2. SELECT polname, polrelid::regclass FROM pg_policy WHERE polname LIKE '%tenant access%';
-- 3. 既存アプリ（匿名アクセス）が引き続き動作する

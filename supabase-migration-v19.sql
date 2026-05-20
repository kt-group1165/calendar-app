-- ============================================================
-- Migration v19: admin が把握している現在のパスワードを domen のみ閲覧可能にする
-- ============================================================
-- 背景:
--   auth.users.encrypted_password は bcrypt hash で平文復元不可。
--   admin がパスワードを set/reset した瞬間にしか平文は手元にない。
--   それを 1 箇所に集めて domen 専用に閲覧させる。
--
-- 設計:
--   - 1 user 1 row (PK = user_id)
--   - service_role が書き込む (reset-password / invite consume endpoint)
--   - SELECT は domen (email='domen@kt-group.co.jp') のみ
--   - 本人がパスワードを変更すると DB の値は stale (本人にしか分からない) →
--     is_stale=true でマークし、UI に「本人が変更した可能性」を出す
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_admin_passwords (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password   TEXT NOT NULL,
  set_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  set_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_stale   BOOLEAN NOT NULL DEFAULT false,
  note       TEXT
);

ALTER TABLE auth_admin_passwords ENABLE ROW LEVEL SECURITY;

-- domen のみ SELECT (email match)
DROP POLICY IF EXISTS auth_admin_passwords_domen_select ON auth_admin_passwords;
CREATE POLICY auth_admin_passwords_domen_select
  ON auth_admin_passwords
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND u.email = 'domen@kt-group.co.jp'
    )
  );

-- INSERT/UPDATE/DELETE は service_role 経由のみ (policy なし → RLS で全否認、service_role は RLS bypass)

COMMENT ON TABLE auth_admin_passwords IS
  'admin が把握している平文パスワード (domen のみ閲覧可、reset/invite 時に service_role が upsert)';

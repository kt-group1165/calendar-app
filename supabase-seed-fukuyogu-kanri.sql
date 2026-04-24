-- ============================================================
-- Seed: 新テナント「福祉用具管理者」を追加
-- ============================================================
-- 目的:
--   order-app とは独立した、福祉用具管理者専用のカレンダーを作成する。
--   他テナント（care-chiba 等）とは完全に分離。
--   事業所・メンバー・種別・エリア・予定は全て別管理。
--
-- URL:
--   https://calendar-app-chi-five.vercel.app/fukuyogu-kanri
--
-- 実行順序:
--   Supabase SQL Editor に以下をそのまま貼り付けて1回実行する。
--   既存データには影響しない（IF NOT EXISTS / ON CONFLICT DO NOTHING）。
-- ============================================================

-- 1) テナント本体
INSERT INTO tenants (id, name)
  VALUES ('fukuyogu-kanri', '福祉用具管理者')
  ON CONFLICT (id) DO NOTHING;

-- 2) 事業所（1件のみ・追加予定なし）
INSERT INTO offices (tenant_id, name, service_type, sort_order)
  SELECT 'fukuyogu-kanri', '福祉用具管理者', '本社', 1
  WHERE NOT EXISTS (
    SELECT 1 FROM offices
     WHERE tenant_id = 'fukuyogu-kanri' AND name = '福祉用具管理者'
  );

-- 3) 既存 master ユーザー全員に新テナントへのアクセス権を付与
--    （どのテナントでも master を持つユーザーは、このテナントでも master にする）
INSERT INTO user_tenants (user_id, tenant_id, role)
  SELECT DISTINCT user_id, 'fukuyogu-kanri', 'master'
    FROM user_tenants
   WHERE role = 'master'
  ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- メンバー・種別・エリア・予定は 0 件スタート。
-- 管理パネルから後追いで追加できる。
-- ============================================================

-- 確認用クエリ（実行後に結果を確認）
-- SELECT * FROM tenants WHERE id = 'fukuyogu-kanri';
-- SELECT * FROM offices WHERE tenant_id = 'fukuyogu-kanri';
-- SELECT * FROM user_tenants WHERE tenant_id = 'fukuyogu-kanri';

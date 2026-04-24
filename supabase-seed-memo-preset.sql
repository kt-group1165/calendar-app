-- ============================================================
-- Seed: メモ欄プリセット初期値
-- ============================================================
-- 目的:
--   福祉用具管理者テナント（fukuyogu-kanri）だけ、予定作成時に
--   メモ欄へ定型文を自動挿入する設定を有効化する。
--   他テナントはオフ（既定）のまま。
--
-- 実行:
--   Supabase SQL Editor で1回実行。ON CONFLICT で重複実行も安全。
-- ============================================================

-- fukuyogu-kanri のみ ON + 本文セット
INSERT INTO settings (key, tenant_id, value)
  VALUES (
    'event_memo_preset_enabled',
    'fukuyogu-kanri',
    'true'
  )
  ON CONFLICT (key, tenant_id) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO settings (key, tenant_id, value)
  VALUES (
    'event_memo_preset_text',
    'fukuyogu-kanri',
    E'予定\n【話す内容、渡すもの】\n\n結果\n【話した内容、渡したもの、リアクション等】'
  )
  ON CONFLICT (key, tenant_id) DO UPDATE SET value = EXCLUDED.value;

-- 他テナントは何もしない（未設定 = OFF 扱い）
-- ============================================================

-- 確認
-- SELECT * FROM settings
--  WHERE key IN ('event_memo_preset_enabled', 'event_memo_preset_text')
--  ORDER BY tenant_id, key;

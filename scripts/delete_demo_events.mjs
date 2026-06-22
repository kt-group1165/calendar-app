// 福祉用具管理者デモ用: 水増しした events (is_demo=true) を全削除
// =====================================================================
// 用途: 再生成や本番デプロイ前のリセット。
//   - hard delete (events table から物理的に DELETE)
//   - 既存の real events (is_demo=false) には触れない
//
// Usage:
//   node scripts/delete_demo_events.mjs              # DRY RUN (件数のみ)
//   node scripts/delete_demo_events.mjs --execute    # 実 DELETE
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const sb = createClient(SB_URL, SB_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

console.log(`[mode] ${MODE}`);

// === 1) demo event 数を確認 ===
const { count, error: cntErr } = await sb
  .from("events")
  .select("*", { count: "exact", head: true })
  .eq("is_demo", true);
if (cntErr) { console.error("count fetch error:", cntErr.message); process.exit(1); }

console.log(`\n対象: is_demo=true の events → ${count ?? 0} 件`);

if ((count ?? 0) === 0) {
  console.log("\n削除対象なし。");
  process.exit(0);
}

if (!EXECUTE) {
  console.log("\n本番実行するには --execute を付けて再実行してください。");
  process.exit(0);
}

// === 2) 物理 DELETE (is_demo=true 全件) ===
console.log("\n[2] DELETE 実行");
const { error: delErr, count: deleted } = await sb
  .from("events")
  .delete({ count: "exact" })
  .eq("is_demo", true);
if (delErr) { console.error("delete error:", delErr.message); process.exit(1); }

console.log(`\n✓ ${deleted ?? "?"} 件 DELETE 完了`);

// 確認
const { count: remain } = await sb
  .from("events")
  .select("*", { count: "exact", head: true })
  .eq("is_demo", true);
console.log(`残り is_demo=true: ${remain ?? 0} 件`);

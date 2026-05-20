// 鎗田 重複 member 統合
//
// 現状:
//   - 鎗田 (fukuyogu-kanri, orange, sort=3, events=0)  ← 削除
//   - 鎗田 秀記 (fukuyogu-kanri, gray, sort=100, events=44) ← color/sort 継承
//   - 鎗田所長 (kt-group, pink, sort=17, events=0) ← リネーム
//   - 鎗田 裕子 (kt-group, gray, sort=100, events=0, パート) ← 別人、touch しない
//
// 結果:
//   - fukuyogu-kanri: 鎗田 秀記 1 行 (orange, sort=3)
//   - kt-group: 鎗田 秀記 1 行 (orange, sort=17) + 鎗田 裕子 (別人) はそのまま
//
// Run: node scripts/merge_yarita.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "..", "..", "kaigo-app", ".env.local"), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORANGE = "#f97316";

// 1) fukuyogu-kanri の「鎗田」 を削除 (events 0 / user_offices 0)
console.log("[1/3] fukuyogu-kanri の「鎗田」(空 row) を削除");
const FUKUYOGU_YARITA_EMPTY = "a3250bac-a261-4c3a-8006-d107f0f0c204";
{
  // 安全確認: events.assignees に '鎗田' が無いことを再確認
  const { count } = await sb
    .from("events")
    .select("*", { count: "exact", head: true })
    .contains("assignees", ["鎗田"]);
  if ((count ?? 0) > 0) {
    console.error(`  events.assignees['鎗田'] が ${count} 件あります — 中止`);
    process.exit(1);
  }
  const { error } = await sb.from("members").delete().eq("id", FUKUYOGU_YARITA_EMPTY);
  if (error) { console.error(`  削除失敗: ${error.message}`); process.exit(1); }
  console.log("  ✓ 削除完了");
}

// 2) fukuyogu-kanri の「鎗田 秀記」 を orange/sort=3 に更新 (見た目継承)
console.log("[2/3] fukuyogu-kanri の「鎗田 秀記」 を orange/sort=3 に更新");
const FUKUYOGU_YARITA_HIDEKI = "51363d64-7665-411a-8d2e-0704d773bdfe";
{
  const { error } = await sb
    .from("members")
    .update({ color: ORANGE, sort_order: 3, updated_at: new Date().toISOString() })
    .eq("id", FUKUYOGU_YARITA_HIDEKI);
  if (error) { console.error(`  更新失敗: ${error.message}`); process.exit(1); }
  console.log("  ✓ 更新完了");
}

// 3) kt-group の「鎗田所長」 を「鎗田 秀記」 にリネーム + color/sort 設定
console.log("[3/3] kt-group の「鎗田所長」 を「鎗田 秀記」 にリネーム");
const KT_YARITA_SHOCHO = "1b22ae37-1f90-4073-8045-a1590d6578cb";
{
  // 重複防止: kt-group に既に「鎗田 秀記」 が無いことを確認
  const { data: dup } = await sb
    .from("members")
    .select("id")
    .eq("tenant_id", "kt-group")
    .eq("name", "鎗田 秀記")
    .maybeSingle();
  if (dup) {
    console.warn(`  kt-group に既に「鎗田 秀記」(id=${dup.id}) が存在 — リネーム skip`);
  } else {
    const { error } = await sb
      .from("members")
      .update({
        name: "鎗田 秀記",
        color: ORANGE,
        sort_order: 17, // 既存 sort=17 を維持 (ケア・サポート他メンバーとの相対位置)
        updated_at: new Date().toISOString(),
      })
      .eq("id", KT_YARITA_SHOCHO);
    if (error) { console.error(`  リネーム失敗: ${error.message}`); process.exit(1); }
    console.log("  ✓ リネーム完了");
  }
}

// 最終確認
console.log("\n=== 最終 状態 ===");
const { data: mems } = await sb.from("members").select("id, name, tenant_id, color, sort_order").or("name.ilike.%鎗田%").order("tenant_id").order("sort_order");
for (const m of mems ?? []) {
  console.log(`  [${m.tenant_id}] ${m.name}  color=${m.color} sort=${m.sort_order}  id=${m.id}`);
}

console.log("\n完了");

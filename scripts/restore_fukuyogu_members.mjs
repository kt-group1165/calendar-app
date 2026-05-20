// 福祉用具管理者カレンダー (fukuyogu-kanri tenant) で events.assignees に居るのに
// members から消えていた 4 人を復活させる。
//
// 失踪 → 対応:
//   米倉    → fukuyogu-kanri に新規 INSERT (color/sort は kt-group の物を引き継ぎ)
//   友野    → 同上
//   前﨑    → 同上
//   鈴木副所長 → fukuyogu-kanri 既存「鈴木」 をリネーム (events.assignees=[鈴木] は 0 件で安全)
//
// 紐付け維持:
//   events.assignees は文字列配列なので変更不要。members 復活させれば admin パネルに
//   出るし event 詳細でも変わらず人として扱われる。

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

// fukuyogu-kanri の現存 sort_order の最大値を取得 (新規 INSERT 時の append 用)
const { data: existing } = await sb
  .from("members")
  .select("sort_order")
  .eq("tenant_id", "fukuyogu-kanri")
  .order("sort_order", { ascending: false })
  .limit(1);
let nextSort = (existing?.[0]?.sort_order ?? 0) + 1;

// 1) 米倉 / 友野 / 前﨑 を fukuyogu-kanri に新規 INSERT
const NEW_MEMBERS = [
  { name: "米倉", color: "#6366f1" }, // kt-group から引き継ぎ
  { name: "友野", color: "#f97316" },
  { name: "前﨑", color: "#ec4899" },
];

console.log("[1/2] fukuyogu-kanri tenant に新規 INSERT");
for (const m of NEW_MEMBERS) {
  // 既に存在なら skip (冪等)
  const { data: ex } = await sb
    .from("members")
    .select("id")
    .eq("tenant_id", "fukuyogu-kanri")
    .eq("name", m.name)
    .maybeSingle();
  if (ex) {
    console.log(`  ${m.name}: 既存 (id=${ex.id}) skip`);
    continue;
  }
  const { data: ins, error } = await sb
    .from("members")
    .insert({
      tenant_id: "fukuyogu-kanri",
      name: m.name,
      color: m.color,
      sort_order: nextSort++,
      status: "active",
    })
    .select("id")
    .single();
  if (error) {
    console.error(`  ${m.name}: 失敗 ${error.message}`);
    continue;
  }
  console.log(`  ✓ ${m.name} 追加 (id=${ins.id}, color=${m.color}, sort=${nextSort - 1})`);
}

// 2) 「鈴木」 → 「鈴木副所長」 にリネーム
console.log("\n[2/2] fukuyogu-kanri tenant 「鈴木」を「鈴木副所長」にリネーム");
const SUZUKI_ID = "11ba4483-3cce-42ec-a134-65892e8b6afa";
{
  // events.assignees=[鈴木] が 0 件であることを再確認
  const { count } = await sb
    .from("events")
    .select("*", { count: "exact", head: true })
    .contains("assignees", ["鈴木"]);
  if ((count ?? 0) > 0) {
    console.error(`  events.assignees に '鈴木' を含む event が ${count} 件 — 中止`);
    process.exit(1);
  }
  // 既に「鈴木副所長」 が居れば衝突避け
  const { data: dup } = await sb
    .from("members")
    .select("id")
    .eq("tenant_id", "fukuyogu-kanri")
    .eq("name", "鈴木副所長")
    .maybeSingle();
  if (dup) {
    console.log(`  既に「鈴木副所長」(id=${dup.id}) が存在 → 既存「鈴木」を削除`);
    const { error: delErr } = await sb.from("members").delete().eq("id", SUZUKI_ID);
    if (delErr) { console.error(`  削除失敗 ${delErr.message}`); process.exit(1); }
    console.log("  ✓ 既存「鈴木」 削除完了");
  } else {
    const { error } = await sb
      .from("members")
      .update({ name: "鈴木副所長", updated_at: new Date().toISOString() })
      .eq("id", SUZUKI_ID);
    if (error) { console.error(`  リネーム失敗 ${error.message}`); process.exit(1); }
    console.log("  ✓ リネーム完了 (color は #10b981 のまま継承)");
  }
}

// 最終確認
console.log("\n=== 最終 fukuyogu-kanri members ===");
const { data: finalMems } = await sb
  .from("members")
  .select("id, name, color, sort_order, status")
  .eq("tenant_id", "fukuyogu-kanri")
  .order("sort_order", { ascending: true });
for (const m of finalMems ?? []) {
  console.log(`  ${m.name.padEnd(12,"　")}  color=${m.color}  sort=${m.sort_order}  status=${m.status}`);
}

console.log("\n完了");

// events_sync_scope_office_ids トリガー (INSERT自動補完 / UPDATE追随 / 手動編集保護) の実地検証
// =====================================================================
// events_compute_auto_scope() 自体は scripts/events-scope-verify.mts (RPC呼出・
// 書込なし) で検証済み。この script はそれだけでは検証できない **トリガー本体**
// (events_sync_scope_office_ids) の3分岐を、実際に INSERT/UPDATE して確認する:
//
//   ① INSERT時、scope_office_ids が空なら auto で埋まる
//   ② UPDATE時、assignees が変わり、旧 scope == 旧 auto (未編集) なら
//      新 auto に追随する
//   ③ UPDATE時、scope_office_ids を手動編集した後は、assignees が変わっても
//      追随しない (手動編集を尊重する)
//
// SAMPLE_DATA_PROTOCOL 準拠: 対象日 2026-12 固定 / title・notes に
// マーカー [sample-g-scope-test] / 1回の実行内で INSERT→検証→DELETE まで完結
// させる (待機中の残留サンプルを作らない)。
//
// Usage:
//   node scripts/events-scope-trigger-test.mjs            # DRY RUN (何もしない)
//   node scripts/events-scope-trigger-test.mjs --execute  # 実行 (最後に自動削除)
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const p of [resolve(__dirname, "../.env.local")]) {
  let txt = "";
  try { txt = readFileSync(p, "utf8"); } catch { continue; }
  for (const l of txt.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXECUTE = process.argv.includes("--execute");
const MARKER = "[sample-g-scope-test]";

// 2026-09-05 実測で確認済みの実在 ID (offices は一切変更しない・読むだけ)
const NO_EXPAND_OFFICE = "00cbb92e-b0c0-43f4-adcc-97d952c39548"; // 福祉用具管理者
const YARITA_NORMAL_OFFICE = "1bfc0d57-9ee0-4ae2-baa5-80edb776290a"; // 介護ショップケア・サポート千葉 (鎗田の通常office)
const YARITA = "鎗田 秀記"; // no_expand + 通常office の兼務
const MULTI_STAFF = "馬渡 春奈";
const MULTI_STAFF_OFFICES = ["c0bf0c6a-c3a7-4e66-8dfd-6c6085050066", "24596958-b434-466e-800b-842f66f84a8e"];

let n = 0, ng = 0;
function eqSet(label, actual, expected) {
  n++;
  const a = [...(actual ?? [])].sort().join(",");
  const b = [...expected].sort().join(",");
  const ok = a === b;
  if (!ok) ng++;
  console.log(`  ${ok ? "OK " : "NG "} ${label.padEnd(56)} ${ok ? "" : `実際=[${a}] 期待=[${b}]`}`);
  return ok;
}

async function main() {
  console.log(`=== events トリガー実地検証 ${EXECUTE ? "【実行】" : "【DRY RUN】"} ===\n`);
  if (!EXECUTE) {
    console.log("以下を1回の実行内で行い、最後に自動削除します:");
    console.log(`  1. INSERT (office=${YARITA_NORMAL_OFFICE} 鎗田の通常office, assignees=[${YARITA}], scope=未指定)`);
    console.log(`     → 期待: scope が [${YARITA_NORMAL_OFFICE}] だけで自動補完される (no_expandは入らない)`);
    console.log(`  2. UPDATE assignees を [${YARITA}, ${MULTI_STAFF}] に変更 (scopeは触らない)`);
    console.log(`     → 期待: 旧scope==旧autoだったので、scopeが新autoに追随する`);
    console.log(`  3. scope_office_ids を手動で ["${NO_EXPAND_OFFICE}"] に上書き (=手動編集を模す)`);
    console.log(`  4. UPDATE assignees を [${YARITA}] に戻す (scopeは触らない)`);
    console.log(`     → 期待: 手動編集後なので、scopeは追随せず ["${NO_EXPAND_OFFICE}"] のまま`);
    console.log(`  5. 作成した行を DELETE して 0 件になることを確認`);
    console.log("\n※ --execute で実行します。");
    return;
  }

  // ── 1. INSERT (scope未指定 → auto補完されるはず) ──
  const { data: inserted, error: insErr } = await sb
    .from("events")
    .insert({
      title: `検証用 ${MARKER}`,
      notes: MARKER,
      start_date: "2026-12-01",
      end_date: "2026-12-01",
      office_id: YARITA_NORMAL_OFFICE,
      assignees: [YARITA],
      event_type: ["その他"],
      created_by: "検証script",
      updated_by: "検証script",
    })
    .select()
    .single();
  if (insErr) { console.error("✗ INSERT失敗:", insErr.message); process.exit(1); }
  const id = inserted.id;
  console.log(`INSERT id=${id}`);
  console.log("\n== ① INSERT時の自動補完 ==");
  eqSet("scope_office_ids が auto で補完される (no_expand除外)", inserted.scope_office_ids, [YARITA_NORMAL_OFFICE]);

  // ── 2. UPDATE assignees (scopeは未編集のまま → 追随するはず) ──
  const { data: updated1, error: upd1Err } = await sb
    .from("events")
    .update({ assignees: [YARITA, MULTI_STAFF] })
    .eq("id", id)
    .select()
    .single();
  if (upd1Err) { console.error("✗ UPDATE①失敗:", upd1Err.message); }
  else {
    console.log("\n== ② UPDATE (assignees変更・scope未編集) → 追随するはず ==");
    eqSet("scopeが新autoに追随 (鎗田の通常office + 馬渡の両office)",
      updated1.scope_office_ids, [YARITA_NORMAL_OFFICE, ...MULTI_STAFF_OFFICES]);
  }

  // ── 3. scope_office_ids を手動編集 (auto と異なる値に) ──
  const manualScope = [NO_EXPAND_OFFICE];
  const { error: manualErr } = await sb
    .from("events")
    .update({ scope_office_ids: manualScope })
    .eq("id", id);
  if (manualErr) console.error("✗ 手動編集UPDATE失敗:", manualErr.message);

  // ── 4. UPDATE assignees (scopeは手動編集済 → 追随しないはず) ──
  const { data: updated2, error: upd2Err } = await sb
    .from("events")
    .update({ assignees: [YARITA] })
    .eq("id", id)
    .select()
    .single();
  if (upd2Err) { console.error("✗ UPDATE②失敗:", upd2Err.message); }
  else {
    console.log("\n== ③ UPDATE (手動編集後にassignees変更) → 追随しないはず ==");
    eqSet("手動編集した scope がそのまま保護される (autoに戻らない)",
      updated2.scope_office_ids, manualScope);
  }

  // ── 5. 撤去 ──
  const { error: delErr, count } = await sb
    .from("events")
    .delete({ count: "exact" })
    .eq("id", id);
  if (delErr) { console.error("✗ 削除失敗 (手動で消してください id=" + id + "):", delErr.message); }
  else console.log(`\n削除: ${count} 件`);

  const { data: remain } = await sb.from("events").select("id").ilike("notes", `%${MARKER}%`);
  console.log(`撤去確認: マーカー付き残存 ${remain?.length ?? "?"} 件 (0 のはず)`);
  if ((remain?.length ?? 1) !== 0) { ng++; n++; console.log("  ✗✗✗ 残留あり。手動で確認すること"); }

  console.log(`\n══ 検査 ${n} 件 / NG ${ng} 件 ══`);
  if (ng > 0) process.exitCode = 1;
}

main();

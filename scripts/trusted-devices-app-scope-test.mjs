// trusted_devices の「承認上限2台」がアプリ単位で正しく数えられているかの実地検証
// =====================================================================
// migrations/trusted_devices_app_scope.sql (2026-08-31 適用済) が
//   「kt_device_id はドメイン単位cookieなので、同じPCでもアプリごとに
//    別device_idになる。上限2台をアプリ単位で数えないと、3つ目の
//    アプリを使った時点で必ず409になる」
// という問題を app 列で是正したはずだが、**2026-08-31 以降に新規登録された
// 端末が 0 件**(2026-09-05 実測)で、修正後の挙動が一度も実地で確認されて
// いない。ここで直接確認する。
//
// ⚠ 認証情報(PIN・パスワード・passkeyの中身)には一切触れない。
// ⚠ 実在するuserの端末は1台も触らない — trusted_devices.user_id は
//    auth.users への FK 制約があるため (2026-09-05 実測で確認)、ダミー
//    UUID は使えない。CLAUDE.md 記載の test@kt-group.co.jp (専用テスト
//    アカウント。2026-09-05実測で既存 trusted_devices 行 0 件) を FK の
//    アンカーにする。**既存行を持たない**ので、実在の承認済み端末を
//    巻き込む心配が無い。追加した行は自分のIDで最後に必ず削除する。
// ⚠ 承認処理そのもの(HTTPエンドポイント・admin認可)は呼ばない。
//    endpoint が実行するのと同じ PostgREST クエリを直接再現して、
//    「カウントの絞り込み」だけを検証する (画面の代わりに DB を直接見る)。
//
// SAMPLE_DATA_PROTOCOL準拠: device_label に [sample-g-devicetest] マーカー。
// 1回の実行内でINSERT→検証→DELETEまで完結。
//
// Usage:
//   node scripts/trusted-devices-app-scope-test.mjs            # DRY RUN
//   node scripts/trusted-devices-app-scope-test.mjs --execute  # 実行
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
const MARKER = "[sample-g-devicetest]";
// test@kt-group.co.jp (専用テストアカウント。既存 trusted_devices 行 0 件・2026-09-05確認)
const FAKE_USER = "97d9eebe-f256-4c1b-b674-073b9eed2795";

let n = 0, ng = 0;
function eq(label, actual, expected) {
  n++;
  const ok = actual === expected;
  if (!ok) ng++;
  console.log(`  ${ok ? "OK " : "NG "} ${label.padEnd(60)} ${ok ? "" : `実際=${actual} 期待=${expected}`}`);
}

/** approve/route.ts:71-83 と同じ PostgREST クエリを再現 (JS移植ではなく同じHTTPクエリ形) */
async function countOthersApproved(userId, app, excludeId) {
  let url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/trusted_devices?select=id&user_id=eq.${userId}&status=eq.approved&id=neq.${excludeId}`;
  if (app !== null) url += `&app=eq.${app}`;
  const r = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!r.ok) throw new Error(`count failed: ${await r.text()}`);
  return Number((r.headers.get("content-range") ?? "0/0").split("/")[1]);
}

async function main() {
  console.log(`=== trusted_devices app-scope 実地検証 ${EXECUTE ? "【実行】" : "【DRY RUN】"} ===`);
  console.log(`FK アンカー user_id: ${FAKE_USER} (test@kt-group.co.jp 専用テストアカウント。既存trusted_devices行0件)\n`);
  if (!EXECUTE) {
    console.log("以下を1回の実行内で行い、最後に自動削除します:");
    console.log("  1. app='calendar' の approved 行を2件 INSERT (calendar-appでの2台承認を模す)");
    console.log("  2. app='kaigo' の 3件目 (未承認想定) を INSERT");
    console.log("  3. 承認判定と同じクエリで「app='calendar' 以外を除いた他approved数」を数える → 2 のはず (上限到達)");
    console.log("  4. 同じクエリで「app='kaigo' の他approved数」を数える → 0 のはず (別アプリなので影響を受けない)");
    console.log("  5. ★負のコントロール: app条件を外して全体で数える → 3 のはず (是正前の挙動なら誤って上限超過扱いになっていたことの証明)");
    console.log("  6. 作成した3行を DELETE して 0 件になることを確認");
    console.log("\n※ --execute で実行します。");
    return;
  }

  const rows = [
    { user_id: FAKE_USER, device_id: "sample-g-1", device_label: `Android Chrome ${MARKER}`, status: "approved", app: "calendar" },
    { user_id: FAKE_USER, device_id: "sample-g-2", device_label: `iPhone Safari ${MARKER}`, status: "approved", app: "calendar" },
    { user_id: FAKE_USER, device_id: "sample-g-3", device_label: `Windows Chrome ${MARKER}`, status: "approved", app: "kaigo" },
  ];
  const { data: inserted, error: insErr } = await sb.from("trusted_devices").insert(rows).select();
  if (insErr) { console.error("✗ INSERT失敗:", insErr.message); process.exit(1); }
  console.log(`INSERT ${inserted.length} 件 (calendar×2 + kaigo×1)\n`);

  const calDevice1 = inserted.find((r) => r.device_id === "sample-g-1");
  const kaigoDevice = inserted.find((r) => r.device_id === "sample-g-3");

  console.log("== ③④ アプリ単位での絞り込み ==");
  const othersInCalendar = await countOthersApproved(FAKE_USER, "calendar", calDevice1.id);
  eq("app='calendar' 内の他approved数 (自分を除く1台+もう1台=1)", othersInCalendar, 1);
  // ↑ calDevice1 自身を除外して数えるので、calendar の approved 2件中 残り1件

  const othersInKaigo = await countOthersApproved(FAKE_USER, "kaigo", kaigoDevice.id);
  eq("app='kaigo' 内の他approved数 (calendarの2台は無関係)", othersInKaigo, 0);

  console.log("\n== 実際の承認判定を模す (3台目のcalendar承認を試みたら?) ==");
  // 3台目の calendar 端末が来たと仮定 (自分自身はまだ無いので id は使わずカウントだけ見る)
  const wouldBeThirdCalendarCount = await countOthersApproved(FAKE_USER, "calendar", "00000000-0000-0000-0000-000000000000");
  eq("3台目のcalendar端末は他2台が引っかかり上限到達 (409になるはず)", wouldBeThirdCalendarCount >= 2 ? 2 : wouldBeThirdCalendarCount, 2);

  console.log("\n== ★ 負のコントロール: app条件を外した場合 (是正前の挙動) ==");
  const naiveGlobalCount = await countOthersApproved(FAKE_USER, null, kaigoDevice.id);
  if (naiveGlobalCount === 2 && othersInKaigo === 0) {
    console.log(`  ✓ 負のコントロール OK — app条件を外すと他approved=${naiveGlobalCount}件 (calendarの2台を巻き込む)。`);
    console.log(`    実際のapp単位クエリでは kaigo の他approved=${othersInKaigo}件。★ 是正が無ければ kaigo の3台目も誤って409になっていた。`);
    n++;
  } else {
    ng++; n++;
    console.log(`  ✗✗✗ 負のコントロール失敗 — app条件の有無で結果が変わらない (naive=${naiveGlobalCount} scoped=${othersInKaigo})`);
  }

  // ── 撤去 ──
  const ids = inserted.map((r) => r.id);
  const { error: delErr, count } = await sb.from("trusted_devices").delete({ count: "exact" }).in("id", ids);
  if (delErr) console.error("✗ 削除失敗 (手動で確認: user_id=" + FAKE_USER + "):", delErr.message);
  else console.log(`\n削除: ${count} 件`);

  const { data: remain } = await sb.from("trusted_devices").select("id").eq("user_id", FAKE_USER);
  console.log(`撤去確認: ダミーuser_id宛の残存 ${remain?.length ?? "?"} 件 (0 のはず)`);
  if ((remain?.length ?? 1) !== 0) { ng++; n++; console.log("  ✗✗✗ 残留あり"); }

  console.log(`\n══ 検査 ${n} 件 / NG ${ng} 件 ══`);
  if (ng > 0) process.exitCode = 1;
}

main();

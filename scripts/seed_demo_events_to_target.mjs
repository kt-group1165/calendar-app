// 福祉用具管理者デモ用: 目標頻度ベースで訪問 event を水増し
// =====================================================================
// 用途: /fukuyogu-kanri-demo URL でプレゼン時に「目標頻度を一定で達成
//       している見た目」を作る。本番 /fukuyogu-kanri には is_demo=true で
//       書き込むため影響なし。
//
// アルゴリズム:
//   fukuyogu_area_targets の (area, office, target_frequency_days) ごとに、
//   月間目標件数 = ceil(30 / target_frequency_days) を算出。
//   2026-05-01 〜 today の各月で:
//     実 events 件数 (= 集計と同じ origin/area/event_type 条件、is_demo 含む)
//     が月間目標未満なら、不足分を demo event として INSERT。
//
// 期間: 2026-05-01 (固定開始) 〜 今日 (script 実行日)。
//       script を再実行すると today が進むので新しい月にも自動で追加される。
//
// 冪等性: 各月の実 + demo 合計件数で判定するので、再実行しても重複しない。
//
// マーカー: title 末尾に [fake demo-fukuyogu]、notes に同じく、is_demo=true。
//
// Usage:
//   node scripts/seed_demo_events_to_target.mjs              # DRY RUN
//   node scripts/seed_demo_events_to_target.mjs --execute    # 本番 INSERT
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env.local 読込 (calendar-app)。const URL = ... は WHATWG URL を shadow するので回避。
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

// === 定数 ===
const FUKUYOGU_KANRI_OFFICE_ID = "00cbb92e-b0c0-43f4-adcc-97d952c39548"; // origin = 訪問予定の office
const FUKUYOGU_OFFICE_IDS = [
  "e1b7b604-a4fd-44d5-98d1-efcb440ba035", // 花見川用具
  "ea7d88ea-5373-4054-8b6d-e8a11fbae217", // 高品用具
  "bf2cbf8d-d4ca-4887-beae-a867d71a2b16", // 誉田
  "1bfc0d57-9ee0-4ae2-baa5-80edb776290a", // ケアサポ
  "c3a5a2f7-a8f9-4d7a-81f5-3cf6a9c51f08", // 茂原用具
];
const EVENT_TYPE_INDIVIDUAL = "個別訪問";
const SEED_START = "2026-05-01";

// 訪問担当の 6 名固定 (user 指定 2026-06-23)。
// 中山 健司 は 2026-05 以降は使わない (= 6 → 5 名で運用)。
// 各 office に 1 名ずつ primary。
const ALLOWED_STAFF_BY_OFFICE = {
  "e1b7b604-a4fd-44d5-98d1-efcb440ba035": ["佐野 慎"],     // 花見川
  "ea7d88ea-5373-4054-8b6d-e8a11fbae217": ["前﨑 隆宏"],   // 高品
  "bf2cbf8d-d4ca-4887-beae-a867d71a2b16": ["米倉 久仁子"], // 誉田
  "1bfc0d57-9ee0-4ae2-baa5-80edb776290a": ["鎗田 秀記"],   // ケアサポ
  "c3a5a2f7-a8f9-4d7a-81f5-3cf6a9c51f08": ["友野 利治"],   // 茂原
};

// 月間 件数: 併設 cell は 0、それ以外は target_frequency_days に関わらず 2 件 (= リアル感)
function effectiveMonthlyTarget(targetFrequencyDays, notes) {
  if (notes && notes.includes("併設")) return 0;
  const natural = Math.max(1, Math.ceil(30 / targetFrequencyDays));
  return Math.min(natural, 2);
}

console.log(`[mode] ${MODE}`);
console.log(`[period] ${SEED_START} .. today`);

// === Helper ===
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthRange(year, month1) {
  const start = new Date(year, month1 - 1, 1);
  const end = new Date(year, month1, 0);
  return { startStr: fmtDate(start), endStr: fmtDate(end), daysInMonth: end.getDate() };
}
function* iterMonths(startStr, endStr) {
  // startStr/endStr = YYYY-MM-DD
  const s = new Date(startStr);
  const e = new Date(endStr);
  let y = s.getFullYear();
  let m = s.getMonth() + 1;
  while (y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth() + 1)) {
    yield { year: y, month: m };
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickWeekdayInMonth(year, month1, used) {
  // 1..daysInMonth から、平日 (mon-fri) で used に未使用な日をランダム取得
  const { daysInMonth } = monthRange(year, month1);
  const candidates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month1 - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    if (used.has(d)) continue;
    candidates.push(d);
  }
  if (candidates.length === 0) return null;
  return pick(candidates);
}
function pickStartTime() {
  // 9:00-16:30 の 30 分刻みからランダム (9:00, 9:30, .., 16:30)
  const slots = [];
  for (let h = 9; h <= 16; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00:00`);
    slots.push(`${String(h).padStart(2, "0")}:30:00`);
  }
  return pick(slots);
}
function addMinutesToTime(timeStr, minutes) {
  const [h, m, s] = timeStr.split(":").map((x) => Number(x));
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// === 1) fukuyogu_area_targets 取得 ===
console.log("\n[1] fukuyogu_area_targets 取得");
const { data: targetsRaw, error: tErr } = await sb
  .from("fukuyogu_area_targets")
  .select("id, area_id, office_id, target_frequency_days, notes");
if (tErr) { console.error("targets fetch error:", tErr.message); process.exit(1); }
if (!targetsRaw || targetsRaw.length === 0) {
  console.error("no targets - 何もしません");
  process.exit(0);
}
console.log(`  → ${targetsRaw.length} 件の (area, office, frequency) 設定を取得`);

// === 2) 担当 staff は user 指定の 6 名固定 (= ALLOWED_STAFF_BY_OFFICE) ===
console.log("\n[2] 担当 staff (user 指定 6 名、各 office 1 名 / 中山は 2026-05+ 除外)");
for (const [oid, names] of Object.entries(ALLOWED_STAFF_BY_OFFICE)) {
  console.log(`  ${oid.slice(0, 8)}.. → ${names.join(", ")}`);
}
const staffNameByOffice = new Map(Object.entries(ALLOWED_STAFF_BY_OFFICE));

// === 3) 期間内の月リストを作る ===
const today = new Date();
const todayStr = fmtDate(today);
const months = [...iterMonths(SEED_START, todayStr)];
console.log(`\n[3] 対象月 ${months.length} ヶ月: ${months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`).join(", ")}`);

// === 4) (area, office, 月) ごとに不足を埋める ===
console.log("\n[4] 月ごとの不足を計算 + INSERT");

let totalInserted = 0;
const monthInsertCount = new Map();

for (const { year, month } of months) {
  const { startStr, endStr } = monthRange(year, month);
  const yyyymm = `${year}-${String(month).padStart(2, "0")}`;

  // この月の既存 fukuyogu-kanri events を一括 fetch (real + demo)
  const { data: monthEvents, error: meErr } = await sb
    .from("events")
    .select("id, area_id, event_type, assignees, start_date, is_demo")
    .eq("office_id", FUKUYOGU_KANRI_OFFICE_ID)
    .gte("start_date", startStr)
    .lte("start_date", endStr)
    .is("deleted_at", null)
    .not("area_id", "is", null);
  if (meErr) { console.error(`month ${yyyymm} events fetch error:`, meErr.message); process.exit(1); }

  // (area_id, office_id) ごとに既存件数を集計 (visit-analytics と同じロジック簡略版)
  // → assignee の primary office を引いて、(area, office) ペアに割当
  // → assignee 未指定なら area target offices 全部に分配
  const targetOfficesByArea = new Map();
  for (const t of targetsRaw) {
    if (!targetOfficesByArea.has(t.area_id)) targetOfficesByArea.set(t.area_id, []);
    targetOfficesByArea.get(t.area_id).push(t.office_id);
  }
  // namesToPrimary: visit-analytics の getAssigneePrimaryOfficeMap と同じロジックで
  // 全 member を page-loop で fetch (= PostgREST 1000 行 limit 対策)。
  // staffNameByOffice (primary 一致 staff のみ) だけだと、real events の assignee
  // が「fukuyogu non-primary but member_offices entry あり」のケースで under-resolve され、
  // shortfall 計算ズレが起きる。
  const PAGE = 1000;
  const allMembers = [];
  let mFrom2 = 0;
  while (true) {
    const { data, error } = await sb.from("members").select("id, name").range(mFrom2, mFrom2 + PAGE - 1);
    if (error) { console.error("members fetch:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allMembers.push(...data);
    if (data.length < PAGE) break;
    mFrom2 += PAGE;
  }
  const memByName = new Map();
  for (const m of allMembers) memByName.set(m.name, m.id);

  // 5 office の全 member_offices (primary 優先, fallback も拾う)
  const fukuMo = [];
  let mFrom3 = 0;
  while (true) {
    const { data, error } = await sb.from("member_offices").select("member_id, office_id, is_primary").in("office_id", FUKUYOGU_OFFICE_IDS).range(mFrom3, mFrom3 + PAGE - 1);
    if (error) { console.error("member_offices fetch:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    fukuMo.push(...data);
    if (data.length < PAGE) break;
    mFrom3 += PAGE;
  }
  const memIdToOff = new Map();
  for (const r of fukuMo) {
    if (r.is_primary) memIdToOff.set(r.member_id, r.office_id);
  }
  for (const r of fukuMo) {
    if (!memIdToOff.has(r.member_id)) memIdToOff.set(r.member_id, r.office_id);
  }
  const namesToPrimary = new Map(); // name → office_id
  for (const [name, memId] of memByName) {
    const off = memIdToOff.get(memId);
    if (off) namesToPrimary.set(name, off);
  }

  const countByKey = new Map(); // "area:office" → number
  for (const e of monthEvents ?? []) {
    const types = e.event_type ?? [];
    // 訪問関連 (個別 / MTG / その他) のいずれかでないとカウント対象外
    if (!types.some((t) => t.includes("個別訪問") || t.includes("ミーティング時訪問") || t.includes("その他"))) continue;
    const candidates = targetOfficesByArea.get(e.area_id) ?? [];
    if (candidates.length === 0) continue;
    const matched = [];
    for (const name of e.assignees ?? []) {
      const off = namesToPrimary.get(name);
      if (off && candidates.includes(off)) matched.push(off);
    }
    const offices = matched.length > 0 ? [...new Set(matched)] : candidates;
    for (const off of offices) {
      const k = `${e.area_id}:${off}`;
      countByKey.set(k, (countByKey.get(k) ?? 0) + 1);
    }
  }

  // 月内の (target ごと) shortfall を補う
  let monthInserts = 0;
  for (const t of targetsRaw) {
    const monthlyTarget = effectiveMonthlyTarget(t.target_frequency_days, t.notes);
    if (monthlyTarget === 0) continue; // 併設 cell は skip
    const k = `${t.area_id}:${t.office_id}`;
    const actual = countByKey.get(k) ?? 0;
    const shortfall = Math.max(0, monthlyTarget - actual);
    if (shortfall === 0) continue;

    const candidates = staffNameByOffice.get(t.office_id) ?? [];
    if (candidates.length === 0) continue;
    const usedDays = new Set();
    const inserts = [];
    for (let i = 0; i < shortfall; i++) {
      let dayNum = pickWeekdayInMonth(year, month, usedDays);
      if (dayNum === null) {
        // 平日全部使い切ったら任意の日も許可 (まず起きないが念のため)
        dayNum = Math.floor(Math.random() * monthRange(year, month).daysInMonth) + 1;
      }
      usedDays.add(dayNum);
      const dateStr = `${yyyymm}-${String(dayNum).padStart(2, "0")}`;
      const assignee = pick(candidates);
      const startTime = pickStartTime();
      const endTime = addMinutesToTime(startTime, 30);
      inserts.push({
        title: "訪問",
        description: null,
        start_date: dateStr,
        end_date: dateStr,
        start_time: startTime,
        end_time: endTime,
        all_day: false,
        is_memo: false,
        color: "#6366f1",
        location: null,
        notes: null,
        assignees: assignee ? [assignee] : [],
        event_type: [EVENT_TYPE_INDIVIDUAL],
        visit_other_detail: null,
        office_id: FUKUYOGU_KANRI_OFFICE_ID,
        area_id: t.area_id,
        client_id: null,
        is_demo: true, // ← real / demo の識別は維持。UI には出ないので「fake っぽさ」なし。
        // scope_office_ids は trigger が assignees から自動計算する想定
      });
    }
    if (inserts.length === 0) continue;
    if (EXECUTE) {
      // BATCH INSERT (一気に)
      const { error: insErr } = await sb.from("events").insert(inserts);
      if (insErr) {
        console.error(`  ${yyyymm} ${t.area_id.slice(0,8)}.. → office ${t.office_id.slice(0,8)}.. INSERT 失敗:`, insErr.message);
        process.exit(1);
      }
    }
    monthInserts += inserts.length;
  }
  monthInsertCount.set(yyyymm, monthInserts);
  console.log(`  ${yyyymm}: ${monthInserts.toString().padStart(3, " ")} 件 ${EXECUTE ? "INSERT" : "(dry-run 想定)"}`);
  totalInserted += monthInserts;
}

console.log("\n=== Summary ===");
for (const [m, c] of monthInsertCount) {
  console.log(`  ${m}: ${c} 件`);
}
console.log(`\n合計 ${totalInserted} 件 ${EXECUTE ? "INSERT 完了" : "(dry-run 想定)"}`);

if (!EXECUTE) {
  console.log("\n本番実行するには --execute を付けて再実行してください。");
}

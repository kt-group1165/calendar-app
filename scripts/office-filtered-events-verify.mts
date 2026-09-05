/**
 * app/[tenant]/page.tsx の officeFilteredEvents に埋まっていた client 側の
 * event 可視判定を lib/events.ts の isEventVisibleInOffice() として切り出し、
 * 挙動が変わっていないことを検証する (2026-09-05)。
 *
 *   npx tsx scripts/office-filtered-events-verify.mts
 *
 * ① 境界値: scope一致 / office_id一致(scope外) / 旧データ(office_id無し+assignee一致) /
 *    どれにも一致しない / auto_scope_no_expand を考慮しない③の限界
 * ② 実データ突き合わせ: 実際の office 1つに対して、DBの scope_office_ids ベースの
 *    件数 (= lib/events.ts が使う .overlaps 相当) と、isEventVisibleInOffice() を
 *    全件に適用した件数を比較し、③(旧データ救済)がどれだけ上乗せしているかを
 *    定量化する。
 * ③ 負のコントロール: ①のORを一部ANDに壊して、実データの件数が変わることを確認。
 *
 * DB は読むだけ。events テーブルへの書込は一切しない。
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "";
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const txt = fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8");
  for (const l of txt.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  // isEventVisibleInOffice 自体はDBに依存しないが、lib/events.ts は
  // module-levelで supabase client (anon key) を作る他関数を含むため、
  // import時のエラーを避けてservice_roleで読めるようにしておく。
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
}
const { isEventVisibleInOffice } = await import("../lib/events");
const { createClient } = await import("@supabase/supabase-js");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let n = 0, ng = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  n++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) ng++;
  console.log(`  ${ok ? "OK " : "NG "} ${label.padEnd(60)} ${ok ? "" : `実際=${JSON.stringify(actual)} 期待=${JSON.stringify(expected)}`}`);
}

type Ev = { scope_office_ids: string[]; office_id: string | null; assignees: string[] };
const OFFICE_A = "office-A";
const OFFICE_B = "office-B";

console.log("══ ① 境界値 ══");
eq("scope一致 → true",
  isEventVisibleInOffice({ scope_office_ids: [OFFICE_A, OFFICE_B], office_id: OFFICE_B, assignees: [] }, OFFICE_A, new Set()), true);
eq("scope不一致だがoffice_id一致(後方互換) → true",
  isEventVisibleInOffice({ scope_office_ids: [], office_id: OFFICE_A, assignees: [] }, OFFICE_A, new Set()), true);
eq("★ 旧データ: office_id無し・assigneeがこのofficeのメンバー → true",
  isEventVisibleInOffice({ scope_office_ids: [], office_id: null, assignees: ["田中太郎"] }, OFFICE_A, new Set(["田中太郎"])), true);
eq("旧データ: office_id無し・assigneeが無関係 → false",
  isEventVisibleInOffice({ scope_office_ids: [], office_id: null, assignees: ["田中太郎"] }, OFFICE_A, new Set()), false);
eq("どれにも一致しない → false",
  isEventVisibleInOffice({ scope_office_ids: [OFFICE_B], office_id: OFFICE_B, assignees: [] }, OFFICE_A, new Set()), false);
eq("assignees空 + office_id無し → false (③は発火しない)",
  isEventVisibleInOffice({ scope_office_ids: [], office_id: null, assignees: [] }, OFFICE_A, new Set(["誰か"])), false);

console.log("\n══ ② 実データ突き合わせ (5福祉用具事業所 + 福祉用具管理者) ══");
const CANDIDATE_OFFICES = [
  ["福祉用具管理者", "00cbb92e-b0c0-43f4-adcc-97d952c39548"],
  ["花見川用具", "e1b7b604-a4fd-44d5-98d1-efcb440ba035"],
  ["高品用具", "ea7d88ea-5373-4054-8b6d-e8a11fbae217"],
  ["誉田", "bf2cbf8d-d4ca-4887-beae-a867d71a2b16"],
  ["ケアサポ", "1bfc0d57-9ee0-4ae2-baa5-80edb776290a"],
  ["茂原用具", "c3a5a2f7-a8f9-4d7a-81f5-3cf6a9c51f08"],
] as const;
type EventRow = { id: string; scope_office_ids: string[] | null; office_id: string | null; assignees: string[] | null; deleted_at: string | null };
async function pageAll<T>(table: string, select: string, orderCol = "id"): Promise<T[]> {
  const out: T[] = []; let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(select).order(orderCol).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}
const allEvents = await pageAll<EventRow>("events", "id, scope_office_ids, office_id, assignees, deleted_at");
const live = allEvents.filter((e) => !e.deleted_at);
const membersRows = await pageAll<{ id: string; name: string }>("members", "id, name");
const moRows = await pageAll<{ member_id: string; office_id: string }>("member_offices", "member_id, office_id", "member_id");
console.log(`【分母】events (deleted_at無し): ${live.length} 件 / 6事業所で突き合わせる`);

const asEv = (e: EventRow): Ev => ({ scope_office_ids: e.scope_office_ids ?? [], office_id: e.office_id, assignees: e.assignees ?? [] });
let totalExtraByOfficeId = 0, totalExtraByLegacy = 0, totalUnexplained = 0;
for (const [label, officeId] of CANDIDATE_OFFICES) {
  const dbScopeMatch = live.filter((e) => (e.scope_office_ids ?? []).includes(officeId));
  const memberIdsInOffice = new Set(moRows.filter((r) => r.office_id === officeId).map((r) => r.member_id));
  const officeMemberNames = new Set(membersRows.filter((m) => memberIdsInOffice.has(m.id)).map((m) => m.name));
  const clientVisible = live.filter((e) => isEventVisibleInOffice(asEv(e), officeId, officeMemberNames));
  const extra = clientVisible.filter((e) => !dbScopeMatch.includes(e));
  const extraByOfficeIdMatch = extra.filter((e) => e.office_id === officeId).length;
  const extraByLegacy = extra.filter((e) => e.office_id == null).length;
  const unexplained = extra.length - extraByOfficeIdMatch - extraByLegacy;
  totalExtraByOfficeId += extraByOfficeIdMatch; totalExtraByLegacy += extraByLegacy; totalUnexplained += unexplained;
  console.log(`  ${label.padEnd(8)} scope一致=${dbScopeMatch.length} / client込み=${clientVisible.length} / ②上乗せ=${extraByOfficeIdMatch} / ③上乗せ=${extraByLegacy}${unexplained ? ` / ★説明不能=${unexplained}` : ""}`);
}
eq("★ 6事業所全部で、①との差分は「②office_id一致」か「③旧データ救済」だけで説明できる (想定外の混入なし)",
  totalUnexplained, 0);
console.log(`  合計: ②上乗せ ${totalExtraByOfficeId} 件 / ③上乗せ ${totalExtraByLegacy} 件`);
if (totalExtraByOfficeId === 0 && totalExtraByLegacy === 0) {
  console.log("  → 6事業所とも②③の実発火は0件 (scope_office_idsだけで全部説明できている、という現状の記録)。");
}

console.log("\n══ ③ 負のコントロール ══");
console.log("  実データで②③が0件だったため、実データ突合ではなく単体テストの変異で確認する。");
{
  // ①のテストケース (scope不一致だがoffice_id一致) で②を壊すと結果が変わることを、
  // 境界値セクションの入力を再利用して確認する。
  const caseForBranch2: Ev = { scope_office_ids: [], office_id: OFFICE_A, assignees: [] };
  const before = isEventVisibleInOffice(caseForBranch2, OFFICE_A, new Set());
  const brokenAnd = (e: Ev, officeId: string): boolean => (e.scope_office_ids ?? []).includes(officeId) && e.office_id === officeId;
  const after = brokenAnd(caseForBranch2, OFFICE_A);
  n++;
  if (before === true && after === false) {
    console.log("  ✓ 負のコントロール OK — ②(後方互換)をORからANDに壊すと、scope未設定+office_id一致の");
    console.log("    テストケースが true→false に変わる。境界値①のテストは実際に②を検証している。");
  } else {
    ng++;
    console.log("  ✗✗✗ 負のコントロール失敗");
  }
}

console.log(`\n══ 検査 ${n} 件 / NG ${ng} 件 ══`);
if (ng > 0) process.exitCode = 1;

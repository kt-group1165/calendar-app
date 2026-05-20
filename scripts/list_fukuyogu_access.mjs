// カレンダーで 福祉用具 を閲覧・修正できるアカウント一覧
//
// calendar-app の getUserScope() ロジックに基づく:
//   1. group_admin         → 全 office 閲覧+修正可
//   2. office_admin (福祉用具) → 自 office + 管理者用 office 閲覧+修正可
//   3. member (福祉用具)       → 自 office のみ 閲覧+修正可
//
// 出力: 各 office の所属 user 一覧 + group_admin 一覧
// Run: node scripts/list_fukuyogu_access.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", "..", "kaigo-app", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// 1) 福祉用具 + 管理者用 offices を取得
const { data: offices, error: oErr } = await sb
  .from("offices")
  .select("id, name, tenant_id, service_type")
  .or("service_type.eq.福祉用具,tenant_id.eq.fukuyogu-kanri");
if (oErr) {
  console.error("offices fetch failed:", oErr.message);
  process.exit(1);
}
console.log(`\n=== 対象 offices (${offices.length}) ===`);
for (const o of offices) {
  console.log(`  - ${o.name}  [tenant=${o.tenant_id}, service_type=${o.service_type ?? "-"}, id=${o.id}]`);
}

// 2) user_offices で各 office に所属する user を取得
const officeIds = offices.map((o) => o.id);
const { data: userOffices, error: uoErr } = await sb
  .from("user_offices")
  .select("user_id, office_id, role")
  .in("office_id", officeIds);
if (uoErr) {
  console.error("user_offices fetch failed:", uoErr.message);
  process.exit(1);
}

// 3) 全 user の auth.users から email を引く
const { data: allUsers, error: uErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
if (uErr) {
  console.error("auth.users fetch failed:", uErr.message);
  process.exit(1);
}
const userById = new Map(allUsers.users.map((u) => [u.id, u]));

// 3b) staff_invitations.display_name (招待 consume 時の表示名) で 1 段目の name 解決
const { data: invRows } = await sb
  .from("staff_invitations")
  .select("consumed_user_id, display_name")
  .not("consumed_user_id", "is", null);
const displayNameByUserId = new Map();
for (const r of invRows ?? []) {
  if (r.consumed_user_id) displayNameByUserId.set(r.consumed_user_id, r.display_name);
}

// 3c) 未解決 user は user_offices.member_id → members.name で 2 段目補完
const allUserIds = [
  ...new Set([
    ...userOffices.map((u) => u.user_id),
    ...(await sb.from("user_groups").select("user_id").eq("role", "group_admin")).data?.map((g) => g.user_id) ?? [],
  ]),
];
const unresolved = allUserIds.filter((uid) => !displayNameByUserId.has(uid));
if (unresolved.length > 0) {
  const { data: uoRows } = await sb
    .from("user_offices")
    .select("user_id, member_id")
    .in("user_id", unresolved);
  const memIdByUser = new Map();
  for (const r of uoRows ?? []) {
    if (r.member_id && !memIdByUser.has(r.user_id)) memIdByUser.set(r.user_id, r.member_id);
  }
  const memIds = [...new Set([...memIdByUser.values()])];
  if (memIds.length > 0) {
    const { data: memRows } = await sb
      .from("members")
      .select("id, name")
      .in("id", memIds);
    const nameByMem = new Map();
    for (const r of memRows ?? []) nameByMem.set(r.id, r.name);
    for (const [uid, mid] of memIdByUser) {
      const n = nameByMem.get(mid);
      if (n) displayNameByUserId.set(uid, n);
    }
  }
}

function nameOf(userId) {
  return displayNameByUserId.get(userId) ?? null;
}

// 4) group_admin 一覧 (user_groups)
const { data: groupAdmins, error: gaErr } = await sb
  .from("user_groups")
  .select("user_id, group_id, role")
  .eq("role", "group_admin");
if (gaErr) {
  console.error("user_groups fetch failed:", gaErr.message);
  process.exit(1);
}

const officeById = new Map(offices.map((o) => [o.id, o]));

// ─── 出力 ───
console.log(`\n=== group_admin (全 calendar 閲覧+修正可) ===`);
for (const ga of groupAdmins) {
  const u = userById.get(ga.user_id);
  const email = u?.email ?? "(unknown)";
  const name = nameOf(ga.user_id);
  console.log(`  - ${name ?? "(名前未解決)"}  / ${email}`);
}

console.log(`\n=== 福祉用具 office 所属 (閲覧+修正可、office_admin は管理者用 office も) ===`);
const byOffice = new Map();
for (const uo of userOffices) {
  if (!byOffice.has(uo.office_id)) byOffice.set(uo.office_id, []);
  byOffice.get(uo.office_id).push(uo);
}
for (const o of offices) {
  const rows = byOffice.get(o.id) ?? [];
  console.log(`\n  [${o.name}] (${rows.length} 人)`);
  if (rows.length === 0) {
    console.log("    (所属 user なし)");
    continue;
  }
  rows.sort((a, b) => (a.role > b.role ? -1 : 1)); // office_admin を先頭
  for (const r of rows) {
    const u = userById.get(r.user_id);
    const email = u?.email ?? "(unknown)";
    const name = nameOf(r.user_id);
    const mark = r.role === "office_admin" ? "★" : " ";
    console.log(`    ${mark} [${r.role}] ${name ?? "(名前未解決)"}  / ${email}`);
  }
}

// ─── 要約 (重複なし email リスト) ───
const accessibleUserIds = new Set();
for (const ga of groupAdmins) accessibleUserIds.add(ga.user_id);
for (const uo of userOffices) accessibleUserIds.add(uo.user_id);

console.log(`\n=== 統合: 福祉用具カレンダー 閲覧+修正可 user (重複排除) ===`);
const summary = [...accessibleUserIds]
  .map((id) => {
    const u = userById.get(id);
    return {
      id,
      email: u?.email ?? "(unknown)",
      name: nameOf(id),
      isGroupAdmin: groupAdmins.some((ga) => ga.user_id === id),
      offices: userOffices
        .filter((uo) => uo.user_id === id)
        .map((uo) => {
          const o = officeById.get(uo.office_id);
          return `${o?.name ?? uo.office_id}(${uo.role})`;
        }),
    };
  })
  .sort((a, b) => (a.name ?? "zzz").localeCompare(b.name ?? "zzz", "ja"));

console.log(`  合計: ${summary.length} 人\n`);
for (const s of summary) {
  const tags = [];
  if (s.isGroupAdmin) tags.push("group_admin");
  if (s.offices.length > 0) tags.push(s.offices.join(", "));
  const namePart = s.name ?? "(名前未解決)";
  console.log(`  - ${namePart}  (${s.email})  [${tags.join(" / ")}]`);
}
console.log("");

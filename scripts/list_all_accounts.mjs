// 全 auth.users + その所属/権限 一覧
//
// 出力:
//   - 名前 / login_id (email) / group_admin? / 各 office と role
//
// Run: node scripts/list_all_accounts.mjs

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

// 1) auth.users 全件
const { data: au, error: auErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
if (auErr) { console.error(auErr.message); process.exit(1); }
const users = au.users;

// 2) user_groups で group_admin 判定
const { data: ug } = await sb
  .from("user_groups")
  .select("user_id, role")
  .eq("role", "group_admin");
const groupAdminSet = new Set((ug ?? []).map((g) => g.user_id));

// 3) user_offices
const { data: uo } = await sb
  .from("user_offices")
  .select("user_id, office_id, role, member_id, is_primary");
const officeByUser = new Map();
for (const r of uo ?? []) {
  if (!officeByUser.has(r.user_id)) officeByUser.set(r.user_id, []);
  officeByUser.get(r.user_id).push(r);
}

// 4) offices ルックアップ
const { data: offices } = await sb
  .from("offices")
  .select("id, name, service_type, tenant_id");
const officeById = new Map((offices ?? []).map((o) => [o.id, o]));

// 5) 名前解決: staff_invitations.display_name → members.name
const { data: invRows } = await sb
  .from("staff_invitations")
  .select("consumed_user_id, display_name")
  .not("consumed_user_id", "is", null);
const nameByUser = new Map();
for (const r of invRows ?? []) {
  if (r.consumed_user_id && r.display_name) nameByUser.set(r.consumed_user_id, r.display_name);
}
// fallback: members 経由
const unresolvedUids = users
  .map((u) => u.id)
  .filter((id) => !nameByUser.has(id));
if (unresolvedUids.length > 0) {
  const memIdByUser = new Map();
  for (const uid of unresolvedUids) {
    const rows = officeByUser.get(uid) ?? [];
    const memId = rows.find((r) => r.member_id)?.member_id;
    if (memId) memIdByUser.set(uid, memId);
  }
  const memIds = [...new Set([...memIdByUser.values()])];
  if (memIds.length > 0) {
    const { data: mems } = await sb
      .from("members")
      .select("id, name, status")
      .in("id", memIds);
    const memById = new Map((mems ?? []).map((m) => [m.id, m]));
    for (const [uid, mid] of memIdByUser) {
      const m = memById.get(mid);
      if (m?.name) nameByUser.set(uid, m.name);
    }
  }
  // さらに fallback: auth.users.user_metadata.display_name
  for (const u of users) {
    if (!nameByUser.has(u.id)) {
      const dn = u.user_metadata?.display_name;
      if (typeof dn === "string" && dn.length > 0) nameByUser.set(u.id, dn);
    }
  }
}

// 6) login_id を email から逆引き
function loginIdOf(email) {
  if (!email) return null;
  const m = /^([a-z][a-z0-9.\-]{3,23})@kt-staff\.invalid$/.exec(email);
  return m ? m[1] : null;
}

// 7) 行整形
const rows = users.map((u) => {
  const id = u.id;
  const name = nameByUser.get(id) ?? "(名前未解決)";
  const email = u.email ?? "";
  const login = loginIdOf(email);
  const isGroupAdmin = groupAdminSet.has(id);
  const ofRows = officeByUser.get(id) ?? [];
  const offices = ofRows
    .map((r) => {
      const o = officeById.get(r.office_id);
      const label = o?.name ?? r.office_id;
      const star = r.is_primary ? "*" : "";
      return `${label}${star}(${r.role})`;
    });
  const pwdChange = u.user_metadata?.password_change_required === true;
  const lastSignIn = u.last_sign_in_at
    ? new Date(u.last_sign_in_at).toISOString().slice(0, 10)
    : "-";
  return {
    name,
    login: login ?? email,
    isGroupAdmin,
    offices,
    pwdChange,
    lastSignIn,
    isSyntheticEmail: !!login,
  };
});

// 8) ソート: group_admin → office あり → 名前順
rows.sort((a, b) => {
  if (a.isGroupAdmin !== b.isGroupAdmin) return a.isGroupAdmin ? -1 : 1;
  const aHasOffice = a.offices.length > 0;
  const bHasOffice = b.offices.length > 0;
  if (aHasOffice !== bHasOffice) return aHasOffice ? -1 : 1;
  return a.name.localeCompare(b.name, "ja");
});

// 9) 出力
console.log(`\n=== 全 auth.users ${users.length} 件 ===\n`);
console.log(`[凡例] ★=group_admin / *=primary office / "(初)"=初回パスワード未変更 / 最終=最終ログイン日`);
console.log("─".repeat(120));

for (const r of rows) {
  const mark = r.isGroupAdmin ? "★" : " ";
  const pwd = r.pwdChange ? "(初)" : "    ";
  const off = r.offices.length > 0 ? r.offices.join(" / ") : "(office なし)";
  const namePad = r.name.padEnd(12, "　").slice(0, 12);
  console.log(`${mark} ${namePad}  ${r.login.padEnd(34)} ${pwd} 最終=${r.lastSignIn}  ${off}`);
}

console.log("\n--- 内訳 ---");
const total = rows.length;
const groupAdmins = rows.filter((r) => r.isGroupAdmin).length;
const withOffice = rows.filter((r) => r.offices.length > 0).length;
const orphans = rows.filter((r) => !r.isGroupAdmin && r.offices.length === 0).length;
const synthetic = rows.filter((r) => r.isSyntheticEmail).length;
const realEmail = rows.filter((r) => !r.isSyntheticEmail).length;
console.log(`  合計 ${total} 件: group_admin ${groupAdmins} / office 所属 ${withOffice} / 孤児 ${orphans}`);
console.log(`  email 種別: synthetic(@kt-staff.invalid) ${synthetic} / 実 email ${realEmail}`);
console.log("");

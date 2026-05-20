// script 直作成 user の staff_invitations を backfill (consumed 済状態)
//
// 目的:
//   /admin/staff ページは staff_invitations 経由の user しか表示しないため、
//   service_role script で auth.users を直作成した user は UI から見えない。
//   office_admin が自事業所 staff の PW reset / passkey 管理を行うために必要。
//
// 対象 (現時点): 佐野 (staff028), 大賀 (staff029)
//   いずれも consumed_at=NOW() / consumed_user_id=実 user_id で INSERT。
//   initial_password_hash は dummy (consumed 後は使われない)。
//
// Run: node scripts/backfill_invitations_for_script_users.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt as _scrypt } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt);

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "..", "..", "kaigo-app", ".env.local"), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// domen の user_id (created_by に使う)
const DOMEN_UID = "70cfdb80-ded3-48d7-a056-d2494e9a08a8";

// scrypt hash format: "scrypt$<salt-hex>$<hash-hex>" (invitations.ts と同じ format 想定)
async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

const { data: au } = await sb.auth.admin.listUsers({ perPage: 1000 });
const { data: invs } = await sb.from("staff_invitations").select("consumed_user_id").not("consumed_user_id","is",null);
const inviteUidSet = new Set((invs??[]).map(r => r.consumed_user_id));

// 全 auth.users で staff_invitations 行が無いもの (group_admin / 実 email user は skip)
const candidates = [];
for (const u of au.users) {
  if (inviteUidSet.has(u.id)) continue;
  // synthetic email のみ対象 (group_admin の domen/test は object out of scope)
  if (!/@kt-staff\.invalid$/.test(u.email ?? "")) continue;

  const { data: uo } = await sb
    .from("user_offices")
    .select("office_id, role, member_id, is_primary")
    .eq("user_id", u.id);
  const primary = (uo ?? []).find((r) => r.is_primary) ?? (uo ?? [])[0];
  if (!primary) {
    console.warn(`  ${u.email}: primary office なし → skip`);
    continue;
  }
  candidates.push({ user: u, primary, login: u.email.split("@")[0] });
}
console.log(`backfill 候補: ${candidates.length} 件\n`);

for (const c of candidates) {
  const name = c.user.user_metadata?.display_name ?? c.login;
  const token = randomBytes(32).toString("base64url");
  const dummyHash = await hashPassword("__backfill_consumed__"); // 使われない
  const nowIso = new Date().toISOString();

  // expires_at は consumed 後は意味を持たないが、整合性のため過去日にする
  const expiredIso = new Date(Date.now() - 24*3600*1000).toISOString();

  const { error } = await sb.from("staff_invitations").insert({
    token,
    display_name: name,
    office_id: c.primary.office_id,
    role: c.primary.role,
    member_id: c.primary.member_id,
    login_id: c.login,
    initial_password_hash: dummyHash,
    created_by: DOMEN_UID,
    consumed_at: nowIso,
    consumed_user_id: c.user.id,
    expires_at: expiredIso,
  });
  if (error) {
    console.error(`  ${name} (${c.login}): ${error.message}`);
    continue;
  }
  console.log(`  ✓ ${name} (${c.login}) → office_id=${c.primary.office_id} role=${c.primary.role}`);
}

console.log("\n完了");

// 佐野 / 大賀 を 中山 / 前﨑 と同じ access pattern で新規作成
//
// 佐野 = 中山 と同じ: Ｈａｎａ福祉用具花見川 (office_admin) + 福祉用具管理者 (member)
// 大賀 = 前﨑 と同じ: 千葉ムツミ福祉用具高品 (office_admin) + 福祉用具管理者 (member)
//
// 投入する 4 種の row:
//   1. auth.users (email=staffNNN@kt-staff.invalid + 初期パスワード)
//   2. members (name, tenant_id='kt-group', auth_user_id link)
//   3. user_offices (primary office, office_admin, is_primary=true)
//   4. user_offices (福祉用具管理者, member, is_primary=false)
//
// Run: node scripts/create_sano_oga.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "..", "..", "kaigo-app", ".env.local"), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// invitations.ts と同じパスワード生成 (紛らわしい 0/O/1/l/I 除外, 12 chars)
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateInitialPassword() {
  const bytes = randomBytes(24);
  let out = "";
  let i = 0;
  while (out.length < 12 && i < bytes.length) {
    const b = bytes[i++];
    if (b < Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length) {
      out += PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length];
    }
  }
  while (out.length < 12) {
    out += PASSWORD_ALPHABET[randomBytes(1)[0] % PASSWORD_ALPHABET.length];
  }
  return out;
}

// 福祉用具管理者 office (共通)
const FUKUYOGU_KANRI_OFFICE_ID = "00cbb92e-b0c0-43f4-adcc-97d952c39548";

const TARGETS = [
  {
    name: "佐野",
    login: "staff028",
    primaryOfficeId: "e1b7b604-a4fd-44d5-98d1-efcb440ba035", // Ｈａｎａ福祉用具花見川
    primaryOfficeLabel: "Ｈａｎａ福祉用具花見川",
    color: "#14b8a6", // teal
    sort_order: 105,
  },
  {
    name: "大賀",
    login: "staff029",
    primaryOfficeId: "ea7d88ea-5373-4054-8b6d-e8a11fbae217", // 千葉ムツミ福祉用具高品
    primaryOfficeLabel: "千葉ムツミ福祉用具高品",
    color: "#a855f7", // purple
    sort_order: 106,
  },
];

const results = [];
for (const t of TARGETS) {
  const email = `${t.login}@kt-staff.invalid`;

  console.log(`\n=== ${t.name} (${t.login}) ===`);

  // 1) auth.users: 既存があれば再利用、なければ作成
  const { data: au } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const existing = au.users.find((u) => u.email === email);
  let userId;
  let password = null;
  if (existing) {
    userId = existing.id;
    console.log(`  [1/4] auth.users 既存利用: user_id=${userId} (password 維持)`);
  } else {
    password = generateInitialPassword();
    const { data: createRes, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: t.name,
        email_verified: true,
        password_change_required: true,
      },
    });
    if (createErr) {
      console.error(`  auth.users 作成失敗:`, createErr.message);
      process.exit(1);
    }
    userId = createRes.user.id;
    console.log(`  [1/4] auth.users 作成: user_id=${userId}`);
  }

  // 2) members: 既存 (tenant_id='kt-group', name=t.name) があれば link、なければ作成
  let memberId;
  const { data: existMem } = await sb
    .from("members")
    .select("id, auth_user_id")
    .eq("tenant_id", "kt-group")
    .eq("name", t.name)
    .maybeSingle();
  if (existMem) {
    memberId = existMem.id;
    // auth_user_id / salary_type を補完 (null の場合のみ touch)
    const patch = {};
    if (existMem.auth_user_id !== userId) patch.auth_user_id = userId;
    patch.salary_type = "時給";
    patch.status = "active";
    const { error: upErr } = await sb.from("members").update(patch).eq("id", memberId);
    if (upErr) {
      console.error(`  members update 失敗:`, upErr.message);
      process.exit(1);
    }
    console.log(`  [2/4] members 既存 link: member_id=${memberId} (auth_user_id 更新)`);
  } else {
    const { data: memRow, error: memErr } = await sb
      .from("members")
      .insert({
        name: t.name,
        tenant_id: "kt-group",
        color: t.color,
        sort_order: t.sort_order,
        status: "active",
        auth_user_id: userId,
        salary_type: "時給",
      })
      .select("id")
      .single();
    if (memErr) {
      console.error(`  members 作成失敗:`, memErr.message);
      process.exit(1);
    }
    memberId = memRow.id;
    console.log(`  [2/4] members 作成: member_id=${memberId}`);
  }

  // helper: 既存があれば update, なければ insert
  async function upsertUserOffice(officeId, role, isPrimary, label) {
    const { data: cur } = await sb
      .from("user_offices")
      .select("user_id")
      .eq("user_id", userId)
      .eq("office_id", officeId)
      .maybeSingle();
    if (cur) {
      const { error: upErr } = await sb
        .from("user_offices")
        .update({ role, member_id: memberId, is_primary: isPrimary })
        .eq("user_id", userId)
        .eq("office_id", officeId);
      if (upErr) throw new Error(`user_offices update (${label}): ${upErr.message}`);
      return `更新`;
    }
    const { error: insErr } = await sb.from("user_offices").insert({
      user_id: userId,
      office_id: officeId,
      role,
      member_id: memberId,
      is_primary: isPrimary,
    });
    if (insErr) throw new Error(`user_offices insert (${label}): ${insErr.message}`);
    return `作成`;
  }

  try {
    const r3 = await upsertUserOffice(t.primaryOfficeId, "office_admin", true, t.primaryOfficeLabel);
    console.log(`  [3/4] user_offices ${r3}: ${t.primaryOfficeLabel} (office_admin)`);
    const r4 = await upsertUserOffice(FUKUYOGU_KANRI_OFFICE_ID, "member", false, "福祉用具管理者");
    console.log(`  [4/4] user_offices ${r4}: 福祉用具管理者 (member)`);
  } catch (e) {
    console.error(`  失敗: ${e.message}`);
    process.exit(1);
  }

  results.push({ ...t, email, password, userId, memberId });
}

console.log("\n✅ 完了\n");
for (const r of results) {
  console.log(`  ${r.name}:`);
  console.log(`    login_id: ${r.login}`);
  console.log(`    email:    ${r.email}`);
  console.log(`    password: ${r.password ?? "(既存 user / 変更なし)"}`);
  console.log("");
}
console.log("新規作成 user は初回ログイン時にパスワード変更を求められます (password_change_required=true)。");

// 重複 Gmail 孤児アカウント 2 件を削除
//   - kt.group.staff769@gmail.com (小岩井恵子) → staff016 (小岩井) と重複
//   - kt.group.staff815@gmail.com (内竹 彩乃)  → staff019 (内竹) と重複
//
// 削除条件 (事前確認済):
//   - user_offices なし / user_groups なし / staff_invitations consumed なし
//   - trusted_devices なし / members link なし / events.created_by なし
//   - last_sign_in_at = (なし) — 一度もログインしていない
//
// Run: node scripts/delete_dup_gmail_accounts.mjs

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

const TARGETS = [
  "kt.group.staff769@gmail.com",
  "kt.group.staff815@gmail.com",
];

const { data: au } = await sb.auth.admin.listUsers({ perPage: 1000 });

for (const email of TARGETS) {
  const u = au.users.find((x) => x.email === email);
  if (!u) {
    console.log(`${email}: 既に削除済 (skip)`);
    continue;
  }
  // 安全のため再度孤児であることを確認
  const [uo, ug, inv, td, m] = await Promise.all([
    sb.from("user_offices").select("user_id", { count: "exact", head: true }).eq("user_id", u.id),
    sb.from("user_groups").select("user_id", { count: "exact", head: true }).eq("user_id", u.id),
    sb.from("staff_invitations").select("token", { count: "exact", head: true }).eq("consumed_user_id", u.id),
    sb.from("trusted_devices").select("id", { count: "exact", head: true }).eq("user_id", u.id),
    sb.from("members").select("id", { count: "exact", head: true }).eq("auth_user_id", u.id),
  ]);
  const counts = {
    user_offices: uo.count, user_groups: ug.count, invitations: inv.count,
    trusted_devices: td.count, members: m.count,
  };
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  if (total > 0) {
    console.error(`${email}: 関連データあり (${JSON.stringify(counts)}) — 削除中止`);
    continue;
  }

  const { error } = await sb.auth.admin.deleteUser(u.id);
  if (error) {
    console.error(`${email}: 削除失敗 ${error.message}`);
    continue;
  }
  console.log(`✓ ${email} 削除 (user_id=${u.id}, display=${u.user_metadata?.display_name ?? "-"})`);
}

console.log("\n完了");

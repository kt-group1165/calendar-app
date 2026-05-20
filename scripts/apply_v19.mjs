// Migration v19 を適用 + 既知の平文パスワードを seed
// Run: node scripts/apply_v19.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", "..", "kaigo-app", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1) Migration SQL 実行
const sql = readFileSync(resolve(__dirname, "..", "supabase-migration-v19.sql"), "utf8");
console.log("[1/2] migration v19 適用");
const { error: sqlErr } = await sb.rpc("exec_sql", { sql });
if (sqlErr) {
  // exec_sql RPC が無い場合: PostgREST 経由では DDL 不可なので、SQL editor で手動実行を促す
  console.error("\n⚠️ exec_sql RPC が無いため、自動適用できません。");
  console.error("Supabase SQL Editor で以下を実行してください:\n");
  console.error("─".repeat(60));
  console.error(sql);
  console.error("─".repeat(60));
  console.error("\n適用後、再度このスクリプトを実行すると seed が走ります。");
  process.exit(1);
}
console.log("  → OK");

// 2) 既知のパスワードを seed
//    手元で plaintext を把握している user のみ:
//    - test@kt-group.co.jp (前回作成、Test1234!)
//    - 佐野 staff028 (今セッションでリセット、mdT4AdQ5mT8E)
//    - 大賀 staff029 (今セッションで新規作成、PvEH28UygEyN)
const SEEDS = [
  { email: "test@kt-group.co.jp",       password: "Test1234!",     note: "テストアカウント (どの端末でもログイン用)" },
  { email: "staff028@kt-staff.invalid", password: "mdT4AdQ5mT8E", note: "佐野 (Phase 11 reset 時の初期 PW)" },
  { email: "staff029@kt-staff.invalid", password: "PvEH28UygEyN", note: "大賀 (新規作成時の初期 PW)" },
];

const { data: au } = await sb.auth.admin.listUsers({ perPage: 1000 });

console.log("[2/2] 既知パスワード seed");
for (const s of SEEDS) {
  const u = au.users.find((x) => x.email === s.email);
  if (!u) {
    console.warn(`  ${s.email}: auth.users に存在せず skip`);
    continue;
  }
  const { error } = await sb.from("auth_admin_passwords").upsert(
    {
      user_id: u.id,
      password: s.password,
      set_at: new Date().toISOString(),
      set_by: null,
      is_stale: false,
      note: s.note,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error(`  ${s.email}: ${error.message}`);
  } else {
    console.log(`  ${s.email}: ${s.password}`);
  }
}
console.log("\n✅ v19 完了");

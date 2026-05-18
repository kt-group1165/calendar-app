// テストアカウント作成 (test@kt-group.co.jp / group_admin)
//
// 仕様:
//   1. Supabase Auth に email + password の user を作成 (既存ならスキップ)
//   2. user_groups に (user_id, group_id='KTグループ', role='group_admin') を upsert
//   3. master bypass: calendar-app の Vercel env MASTER_USER_EMAILS に
//      別途 test@kt-group.co.jp を追加すれば、device trust + passkey 強制を bypass
//
// Run: node scripts/create_test_user.mjs
//
// 既定パスワード: 引数 --password=XXXX、無ければ "Test1234!" を使用

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// service_role key は kaigo-app/.env.local に格納されている (4 app 共通 Supabase)
const envPath = resolve(__dirname, "..", "..", "kaigo-app", ".env.local");
const envText = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  process.exit(1);
}

const TEST_EMAIL = "test@kt-group.co.jp";
const cliPassword = process.argv
  .find((a) => a.startsWith("--password="))
  ?.split("=")[1];
const TEST_PASSWORD = cliPassword || "Test1234!";
const GROUP_SHORT_NAME = "KTグループ";

const sb = createClient(SB_URL, SB_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1) Auth user を取得 or 作成
console.log(`[step 1] Auth user 確認/作成: ${TEST_EMAIL}`);
const { data: existingUsers, error: listErr } = await sb.auth.admin.listUsers({
  perPage: 1000,
});
if (listErr) {
  console.error("listUsers failed:", listErr.message);
  process.exit(1);
}
let userId = existingUsers.users.find((u) => u.email === TEST_EMAIL)?.id ?? null;

if (userId) {
  console.log(`  → 既存 user (${userId}) のパスワードを ${TEST_PASSWORD} で更新`);
  const { error: updErr } = await sb.auth.admin.updateUserById(userId, {
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (updErr) {
    console.error("updateUserById failed:", updErr.message);
    process.exit(1);
  }
} else {
  const { data: createRes, error: createErr } = await sb.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "テストユーザー" },
  });
  if (createErr) {
    console.error("createUser failed:", createErr.message);
    process.exit(1);
  }
  userId = createRes.user?.id ?? null;
  if (!userId) {
    console.error("created but user.id is missing");
    process.exit(1);
  }
  console.log(`  → 新規作成 user_id=${userId}`);
}

// 2) groups から KTグループ の id を取得
console.log(`[step 2] groups テーブルから "${GROUP_SHORT_NAME}" の group_id を取得`);
const { data: grp, error: grpErr } = await sb
  .from("groups")
  .select("id, short_name")
  .eq("short_name", GROUP_SHORT_NAME)
  .single();
if (grpErr || !grp) {
  console.error(`groups で short_name='${GROUP_SHORT_NAME}' が見つかりません`);
  process.exit(1);
}
console.log(`  → group_id=${grp.id}`);

// 3) user_groups に group_admin で upsert
console.log(`[step 3] user_groups に group_admin row を upsert`);
const { error: ugErr } = await sb.from("user_groups").upsert(
  {
    user_id: userId,
    group_id: grp.id,
    role: "group_admin",
  },
  { onConflict: "user_id,group_id" },
);
if (ugErr) {
  console.error("user_groups upsert failed:", ugErr.message);
  process.exit(1);
}

// 4) 検証: user_groups の row を select
const { data: verify } = await sb
  .from("user_groups")
  .select("user_id, group_id, role")
  .eq("user_id", userId)
  .eq("group_id", grp.id);
console.log(`  → 投入後 verify:`, verify);

console.log(`
✅ テストアカウント作成完了
   email:    ${TEST_EMAIL}
   password: ${TEST_PASSWORD}
   role:     group_admin (KTグループ)

次のステップ:
  - calendar-app の Vercel env MASTER_USER_EMAILS に追加:
      domen@kt-group.co.jp,test@kt-group.co.jp
  - Save → Redeploy
  - test@kt-group.co.jp でログイン
`);

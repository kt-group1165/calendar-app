import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";

// POST /api/admin/staff/reset-password
//
// admin が staff のパスワードをリセット:
//   1. 12 文字ランダム password 生成
//   2. auth.users.password を更新
//   3. user_metadata.password_change_required = true (= 次回 login 時に強制変更)
//   4. 新 password を 1 回だけ response で返す (admin が本人に伝達)
//
// 入力: { user_id: string }
// 出力: { ok: true, password: string }
//
// 権限: stop/delete と同様 (auth_admin_office_ids() に target office が含まれること)

function genPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let p = "";
  for (let i = 0; i < 12; i++) p += chars[crypto.randomInt(0, chars.length)];
  return p;
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const { user_id } = (body ?? {}) as { user_id?: unknown };
  if (typeof user_id !== "string" || user_id.length === 0) {
    return NextResponse.json({ error: "user_id_invalid" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: adminRows, error: adminError } = await supabase.rpc("auth_admin_office_ids");
  if (adminError) {
    return NextResponse.json({ error: "permission_check_failed" }, { status: 500 });
  }
  type AdminRow = { auth_admin_office_ids?: string } | string;
  const adminOfficeIds = ((adminRows ?? []) as AdminRow[]).map((r) =>
    typeof r === "string" ? r : r.auth_admin_office_ids ?? ""
  );

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return NextResponse.json({ error: "service_key_missing" }, { status: 500 });
  }
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // target の office を取得 (権限チェック用)
  const { data: targetRows, error: targetError } = await admin
    .from("user_offices")
    .select("office_id")
    .eq("user_id", user_id);
  if (targetError) {
    return NextResponse.json({ error: "target_lookup_failed" }, { status: 500 });
  }
  const targetOfficeIds = (targetRows ?? []).map((r) => (r as { office_id: string }).office_id);
  const allowed = targetOfficeIds.some((oid) => adminOfficeIds.includes(oid));
  if (!allowed && targetOfficeIds.length > 0) {
    return NextResponse.json({ error: "permission_denied" }, { status: 403 });
  }
  // 2026-08-31 監査での是正:
  //   上の条件は targetOfficeIds が空だとガードごと素通りしていた。
  //   実測で auth ユーザ 41 名中 9 名が user_offices 行を持たず、その 1 つが
  //   ALWAYS_TRUSTED_EMAILS の test@kt-group.co.jp。= 一般 member が
  //   そのアカウントを乗っ取れた。delete/route.ts と同じく group_admin 限定にする。
  if (targetOfficeIds.length === 0) {
    const { data: groupRows } = await supabase.rpc("auth_user_admin_tenants");
    if (((groupRows ?? []) as Array<unknown>).length === 0) {
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    }
  }

  // target の現在の user_metadata を取得 (merge 用)
  const { data: targetUser } = await admin.auth.admin.getUserById(user_id);
  const existingMeta = targetUser?.user?.user_metadata ?? {};

  const newPassword = genPassword();
  const { error: updError } = await admin.auth.admin.updateUserById(user_id, {
    password: newPassword,
    user_metadata: {
      ...existingMeta,
      password_change_required: true,
    },
  });
  if (updError) {
    return NextResponse.json({ error: "reset_failed", detail: updError.message }, { status: 500 });
  }

  // v19: 平文を auth_admin_passwords に upsert (domen のみ閲覧可、RLS で守る)
  //   失敗しても reset 自体は成功している (= response は返す) ので、log のみ。
  const { error: pwStoreError } = await admin.from("auth_admin_passwords").upsert(
    {
      user_id,
      password: newPassword,
      set_at: new Date().toISOString(),
      set_by: userData.user.id,
      is_stale: false,
      note: "reset via /admin/staff",
    },
    { onConflict: "user_id" },
  );
  if (pwStoreError) {
    console.warn(`[reset-password] auth_admin_passwords upsert failed for ${user_id}:`, pwStoreError.message);
  }

  return NextResponse.json({ ok: true, password: newPassword });
}

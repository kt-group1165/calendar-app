import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// POST /api/admin/passkey/revoke-all
//
// admin が指定 user の Passkey を全削除する (= PW ログインに戻す)。
// 端末紛失・退職・本人からの依頼などで使う。
//
// 入力: { target_user_id: string }
// 出力: { deleted_count }
//
// 権限: 対象 user の所属 office を admin scope に含む user のみ可。

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { target_user_id } = (body ?? {}) as { target_user_id?: unknown };
  if (typeof target_user_id !== "string" || target_user_id.length === 0) {
    return NextResponse.json({ error: "target_user_id_invalid" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 認可: 呼出 admin が target user の office を 1 つでも管理しているか
  const { data: callerAdminOffices, error: adminErr } = await supabase.rpc("auth_admin_office_ids");
  if (adminErr) {
    return NextResponse.json({ error: "permission_check_failed" }, { status: 500 });
  }
  type AdminRow = { auth_admin_office_ids?: string } | string;
  const adminOfficeIds = ((callerAdminOffices ?? []) as AdminRow[]).map((r) =>
    typeof r === "string" ? r : r.auth_admin_office_ids ?? ""
  );

  const admin = createAdminClient();
  const { data: targetOffices } = await admin
    .from("user_offices")
    .select("office_id")
    .eq("user_id", target_user_id);
  const targetOfficeIds = ((targetOffices ?? []) as { office_id: string }[]).map((r) => r.office_id);
  const hasOverlap = targetOfficeIds.some((id) => adminOfficeIds.includes(id));

  // group/company admin は overlap 無くても OK
  const { data: callerGroups } = await supabase.rpc("auth_admin_group_ids");
  const isGroupOrCompanyAdmin = (callerGroups ?? []).length > 0;

  if (!hasOverlap && !isGroupOrCompanyAdmin) {
    return NextResponse.json({ error: "not_permitted" }, { status: 403 });
  }

  // passkey_credentials を全削除 + 未 consume grant も無効化
  const { data: deleted, error: delErr } = await admin
    .from("passkey_credentials")
    .delete()
    .eq("user_id", target_user_id)
    .select("id");
  if (delErr) {
    return NextResponse.json({ error: "delete_failed", detail: delErr.message }, { status: 500 });
  }

  // 待機中の grant も掃除 (リセット後の追加登録は admin が改めて発行する想定)
  await admin
    .from("passkey_registration_grants")
    .delete()
    .eq("user_id", target_user_id)
    .is("consumed_at", null);

  return NextResponse.json({
    deleted_count: (deleted ?? []).length,
  });
}

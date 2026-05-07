import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// POST /api/admin/staff/delete
//
// office_admin / company_admin / group_admin が「招待 consume 済アカウント」を
// 削除する。
//
// 入力: { user_id: string }     ← 削除対象 auth.users.id
// 出力: { ok: true }
//
// 権限検証:
//   1. 呼出ユーザが auth セッション持ち
//   2. 削除対象ユーザの user_offices.office_id が、
//      呼出ユーザの auth_admin_office_ids() に含まれる
//      (= 呼出ユーザがその office に対する admin 権限を持つ)
//   3. group_admin が他事業所の auth ユーザを消すのは許容
//      (RLS で auth_admin_office_ids が tenant 全体を返すため)
//
// 実処理:
//   - admin.auth.deleteUser(user_id)
//     → user_offices CASCADE で消える (FK 設定済)
//     → auth.users 行も消える
//   - 残った staff_invitations.consumed_user_id は dangling になるが
//     consumed_at は残るので「履歴」として参照可能
//   - members は残す (他のスタッフ・予定が紐付いている可能性)

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { user_id } = (body ?? {}) as { user_id?: unknown };
  if (typeof user_id !== "string" || user_id.length === 0) {
    return NextResponse.json({ error: "user_id_invalid" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const callerId = userData.user.id;

  if (callerId === user_id) {
    // 自分で自分のアカウントを消すのは UI 上禁止 (誤操作防止)
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  // 1) 呼出ユーザの管理可能 office 集合を取得
  const { data: adminRows, error: adminError } = await supabase.rpc("auth_admin_office_ids");
  if (adminError) {
    return NextResponse.json({ error: "permission_check_failed" }, { status: 500 });
  }
  type AdminRow = { auth_admin_office_ids?: string } | string;
  const adminOfficeIds = ((adminRows ?? []) as AdminRow[]).map((r) =>
    typeof r === "string" ? r : r.auth_admin_office_ids ?? ""
  );

  // 2) 削除対象ユーザの所属 office を service_role 経由で取得 (RLS 経由だと
  //    自分の見える office に絞られて返ってこないため)
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return NextResponse.json({ error: "service_key_missing" }, { status: 500 });
  }
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: targetOffices, error: targetError } = await admin
    .from("user_offices")
    .select("office_id")
    .eq("user_id", user_id);
  if (targetError) {
    return NextResponse.json({ error: "target_lookup_failed" }, { status: 500 });
  }
  const targetOfficeIds = (targetOffices ?? []).map((r) => (r as { office_id: string }).office_id);

  // 3) 呼出ユーザが target の少なくとも 1 office を管理できるか
  //    管理できる office が 1 つでもあれば削除許可 (= "私の事業所のスタッフ" として消せる)
  const allowed = targetOfficeIds.some((oid) => adminOfficeIds.includes(oid));
  if (!allowed && targetOfficeIds.length > 0) {
    return NextResponse.json({ error: "permission_denied" }, { status: 403 });
  }
  // user_offices 行が無いゴーストユーザは group_admin のみ削除可
  if (targetOfficeIds.length === 0) {
    // group_admin かどうかチェック
    const { data: groupRows } = await supabase.rpc("auth_user_admin_tenants");
    const groupCount = ((groupRows ?? []) as Array<unknown>).length;
    if (groupCount === 0) {
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    }
  }

  // 4) 削除実行
  const { error: deleteError } = await admin.auth.admin.deleteUser(user_id);
  if (deleteError) {
    return NextResponse.json(
      { error: "delete_failed", detail: deleteError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

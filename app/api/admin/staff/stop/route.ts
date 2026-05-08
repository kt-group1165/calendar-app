import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// POST /api/admin/staff/stop
//
// スタッフを「停止」にする (削除はしない、過去予定・給与履歴は保持):
//   1. auth.users.banned_until = far future (login 不可化)
//   2. members.status = 'inactive' (全 member_id について)
//   3. payroll_employees.employment_status = '退職者' + resignation_date = today
//      (display_name + office_id 一致で名寄せ)
//
// 入力: { user_id: string }
// 出力: { ok: true }
//
// 権限: delete と同様 (auth_admin_office_ids() に target office が含まれること)

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
  const callerId = userData.user.id;
  if (callerId === user_id) {
    return NextResponse.json({ error: "cannot_stop_self" }, { status: 400 });
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

  // 1) target の office + member_id 取得
  const { data: targetRows, error: targetError } = await admin
    .from("user_offices")
    .select("office_id, member_id")
    .eq("user_id", user_id);
  if (targetError) {
    return NextResponse.json({ error: "target_lookup_failed" }, { status: 500 });
  }
  const targetOfficeIds = (targetRows ?? []).map((r) => (r as { office_id: string }).office_id);
  const targetMemberIds = (targetRows ?? [])
    .map((r) => (r as { member_id: string | null }).member_id)
    .filter((m): m is string => !!m);

  // 2) 権限チェック
  const allowed = targetOfficeIds.some((oid) => adminOfficeIds.includes(oid));
  if (!allowed && targetOfficeIds.length > 0) {
    return NextResponse.json({ error: "permission_denied" }, { status: 403 });
  }

  // 3) auth.users を ban (100 年)
  const { error: banError } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: "876000h", // 100 years
  });
  if (banError) {
    return NextResponse.json({ error: "ban_failed", detail: banError.message }, { status: 500 });
  }

  // 4) members.status = 'inactive'
  let membersUpdated = 0;
  if (targetMemberIds.length > 0) {
    const { data: mRes, error: mError } = await admin
      .from("members")
      .update({ status: "inactive" })
      .in("id", targetMemberIds)
      .select("id");
    if (mError) {
      // 部分失敗扱いで続行 (ban は成功してるので、続けて payroll も試す)
      console.error("members update error:", mError);
    } else {
      membersUpdated = mRes?.length ?? 0;
    }
  }

  // 5) payroll_employees.employment_status = '退職者' + resignation_date (display_name + office_id で名寄せ)
  //    name は staff_invitations.display_name から逆引き、office_id は user_offices.office_id
  let payrollUpdated = 0;
  if (targetOfficeIds.length > 0) {
    const { data: invRows } = await admin
      .from("staff_invitations")
      .select("display_name")
      .eq("consumed_user_id", user_id)
      .limit(1)
      .maybeSingle();
    const displayName = (invRows as { display_name?: string } | null)?.display_name;
    if (displayName) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: pRes, error: pError } = await admin
        .from("payroll_employees")
        .update({ employment_status: "退職者", resignation_date: today })
        .eq("name", displayName)
        .in("office_id", targetOfficeIds)
        .select("id");
      if (pError) {
        console.error("payroll update error:", pError);
      } else {
        payrollUpdated = pRes?.length ?? 0;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    members_updated: membersUpdated,
    payroll_updated: payrollUpdated,
  });
}

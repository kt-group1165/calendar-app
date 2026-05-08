import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// POST /api/admin/staff/restore
//
// 停止状態のスタッフを「復帰」させる:
//   1. auth.users.banned_until = none (login 復活)
//   2. members.status = 'active'
//   3. payroll_employees.employment_status = '在職者' + resignation_date = NULL
//      (display_name + office_id 一致で名寄せ)

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

  const allowed = targetOfficeIds.some((oid) => adminOfficeIds.includes(oid));
  if (!allowed && targetOfficeIds.length > 0) {
    return NextResponse.json({ error: "permission_denied" }, { status: 403 });
  }

  // 1) auth.users ban 解除
  const { error: banError } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: "none",
  });
  if (banError) {
    return NextResponse.json({ error: "unban_failed", detail: banError.message }, { status: 500 });
  }

  // 2) members.status = 'active'
  let membersUpdated = 0;
  if (targetMemberIds.length > 0) {
    const { data: mRes } = await admin
      .from("members")
      .update({ status: "active" })
      .in("id", targetMemberIds)
      .select("id");
    membersUpdated = mRes?.length ?? 0;
  }

  // 3) payroll_employees の在職復帰
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
      const { data: pRes } = await admin
        .from("payroll_employees")
        .update({ employment_status: "在職者", resignation_date: null })
        .eq("name", displayName)
        .in("office_id", targetOfficeIds)
        .select("id");
      payrollUpdated = pRes?.length ?? 0;
    }
  }

  return NextResponse.json({
    ok: true,
    members_updated: membersUpdated,
    payroll_updated: payrollUpdated,
  });
}

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// POST /api/admin/devices/approve
//
// admin が pending 状態の trusted_devices row を approved に変える。
// 入力:  { device_id_uuid: string }   (trusted_devices.id)
// 出力:  { ok: true }
// 権限: 対象 user の所属 office を admin scope に含む user。

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { device_id_uuid?: unknown };
  const { device_id_uuid } = body;
  if (typeof device_id_uuid !== "string" || device_id_uuid.length === 0) {
    return NextResponse.json({ error: "device_id_uuid_invalid" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 対象 row + target user を引いて scope 判定
  const admin = createAdminClient();
  const { data: row, error: rowErr } = await admin
    .from("trusted_devices")
    .select("id, user_id, status")
    .eq("id", device_id_uuid)
    .maybeSingle();
  if (rowErr || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 認可: target user の office を呼出 admin の scope に含むか
  const { data: callerAdminOffices } = await supabase.rpc("auth_admin_office_ids");
  type AdminRow = { auth_admin_office_ids?: string } | string;
  const adminOfficeIds = ((callerAdminOffices ?? []) as AdminRow[]).map((r) =>
    typeof r === "string" ? r : r.auth_admin_office_ids ?? ""
  );
  const { data: targetOffices } = await admin
    .from("user_offices")
    .select("office_id")
    .eq("user_id", row.user_id);
  const targetOfficeIds = ((targetOffices ?? []) as { office_id: string }[]).map((r) => r.office_id);
  const hasOverlap = targetOfficeIds.some((id) => adminOfficeIds.includes(id));
  const { data: callerGroups } = await supabase.rpc("auth_admin_group_ids");
  const isGroupOrCompanyAdmin = (callerGroups ?? []).length > 0;
  if (!hasOverlap && !isGroupOrCompanyAdmin) {
    return NextResponse.json({ error: "not_permitted" }, { status: 403 });
  }

  // Phase 11c-2 → 緩和: 「1 端末固定」を廃止し、user は複数端末を同時に approved にできる。
  //   ただし上限 5 台に制限する。既に 5 台 approved な user の 6 台目承認は 409 を返し、
  //   admin に既存端末の revoke を促す。
  const APPROVED_DEVICE_LIMIT = 5;
  const { count: othersApprovedCount } = await admin
    .from("trusted_devices")
    .select("*", { count: "exact", head: true })
    .eq("user_id", row.user_id)
    .eq("status", "approved")
    .neq("id", device_id_uuid);
  if ((othersApprovedCount ?? 0) >= APPROVED_DEVICE_LIMIT) {
    return NextResponse.json(
      {
        error: "approved_limit_exceeded",
        message: `承認済み端末は最大 ${APPROVED_DEVICE_LIMIT} 台までです。先に既存の端末を 1 台 revoke (拒否) してから承認してください。`,
      },
      { status: 409 }
    );
  }

  // 対象 row を approved に
  const { error: upErr } = await admin
    .from("trusted_devices")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: userData.user.id,
      revoked_at: null,
    })
    .eq("id", device_id_uuid);
  if (upErr) {
    return NextResponse.json({ error: "update_failed", detail: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

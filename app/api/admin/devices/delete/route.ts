import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// POST /api/admin/devices/delete
//
// admin が trusted_devices row を完全削除する (= 履歴ごと消す)。
// 用途: revoked 行を整理、誤って作成された pending を消す等。
// 入力: { device_id_uuid: string }
// 出力: { ok: true }

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

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("trusted_devices")
    .select("id, user_id")
    .eq("id", device_id_uuid)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

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

  const { error: delErr } = await admin.from("trusted_devices").delete().eq("id", device_id_uuid);
  if (delErr) {
    return NextResponse.json({ error: "delete_failed", detail: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

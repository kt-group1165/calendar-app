import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// POST /api/admin/staff/add-office
//
// あるスタッフ (auth user + member) を別 office にも所属させる:
//   1. member_offices junction に (member_id, office_id, is_primary=false) INSERT
//   2. user_offices に (user_id, office_id, role='member', member_id, is_primary=false) INSERT
//
// 入力: { user_id: string, member_id: string, office_id: string }
// 出力: { ok: true }
//
// 権限: 呼出 admin が target office_id を auth_admin_office_ids() に持つこと。
//       (= 自分が admin である office にしか追加できない)

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const { user_id, member_id, office_id } = (body ?? {}) as {
    user_id?: unknown;
    member_id?: unknown;
    office_id?: unknown;
  };
  if (typeof user_id !== "string" || user_id.length === 0) {
    return NextResponse.json({ error: "user_id_invalid" }, { status: 400 });
  }
  if (typeof member_id !== "string" || member_id.length === 0) {
    return NextResponse.json({ error: "member_id_invalid" }, { status: 400 });
  }
  if (typeof office_id !== "string" || office_id.length === 0) {
    return NextResponse.json({ error: "office_id_invalid" }, { status: 400 });
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
  if (!adminOfficeIds.includes(office_id)) {
    return NextResponse.json({ error: "permission_denied" }, { status: 403 });
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return NextResponse.json({ error: "service_key_missing" }, { status: 500 });
  }
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // 既に紐付いていれば 409
  const { data: existingMo } = await admin
    .from("member_offices")
    .select("member_id")
    .eq("member_id", member_id)
    .eq("office_id", office_id)
    .maybeSingle();
  if (existingMo) {
    return NextResponse.json({ error: "already_assigned" }, { status: 409 });
  }
  const { data: existingUo } = await admin
    .from("user_offices")
    .select("user_id")
    .eq("user_id", user_id)
    .eq("office_id", office_id)
    .maybeSingle();
  if (existingUo) {
    return NextResponse.json({ error: "already_assigned" }, { status: 409 });
  }

  // 1) member_offices INSERT (is_primary=false)
  const { error: moError } = await admin
    .from("member_offices")
    .insert({ member_id, office_id, is_primary: false });
  if (moError) {
    return NextResponse.json({ error: "member_offices_insert_failed", detail: moError.message }, { status: 500 });
  }

  // 2) user_offices INSERT (role='member', is_primary=false, member_id 紐付け)
  const { error: uoError } = await admin
    .from("user_offices")
    .insert({
      user_id,
      office_id,
      role: "member",
      member_id,
      is_primary: false,
    });
  if (uoError) {
    // rollback member_offices
    await admin
      .from("member_offices")
      .delete()
      .eq("member_id", member_id)
      .eq("office_id", office_id);
    return NextResponse.json({ error: "user_offices_insert_failed", detail: uoError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

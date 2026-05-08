import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// POST /api/admin/staff/remove-office
//
// あるスタッフを ある office から外す (member_offices + user_offices DELETE)。
// primary 行は禁止 (先に primary を切替えるよう要求)。
//
// 入力: { user_id: string, member_id: string, office_id: string }
// 出力: { ok: true }
//
// 権限: 呼出 admin が target office_id を auth_admin_office_ids() に持つこと。

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

  // primary チェック (member_offices と user_offices どちらかでも primary なら 400)
  const [moRes, uoRes] = await Promise.all([
    admin
      .from("member_offices")
      .select("is_primary")
      .eq("member_id", member_id)
      .eq("office_id", office_id)
      .maybeSingle(),
    admin
      .from("user_offices")
      .select("is_primary")
      .eq("user_id", user_id)
      .eq("office_id", office_id)
      .maybeSingle(),
  ]);
  const moIsPrimary = (moRes.data as { is_primary?: boolean } | null)?.is_primary === true;
  const uoIsPrimary = (uoRes.data as { is_primary?: boolean } | null)?.is_primary === true;
  if (moIsPrimary || uoIsPrimary) {
    return NextResponse.json({ error: "cannot_remove_primary" }, { status: 400 });
  }

  // member_offices DELETE
  const { error: moDelError } = await admin
    .from("member_offices")
    .delete()
    .eq("member_id", member_id)
    .eq("office_id", office_id);
  if (moDelError) {
    return NextResponse.json({ error: "member_offices_delete_failed", detail: moDelError.message }, { status: 500 });
  }

  // user_offices DELETE
  const { error: uoDelError } = await admin
    .from("user_offices")
    .delete()
    .eq("user_id", user_id)
    .eq("office_id", office_id);
  if (uoDelError) {
    return NextResponse.json({ error: "user_offices_delete_failed", detail: uoDelError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

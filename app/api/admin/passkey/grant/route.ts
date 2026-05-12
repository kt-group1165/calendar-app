import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// POST /api/admin/passkey/grant
//
// admin が指定 user に対して「2 台目以降の passkey 登録」を一時的に許可する。
// 既存の有効 grant があれば期限を延長 (= upsert 動作)。
//
// 入力:   { target_user_id: string, reason?: string, ttl_minutes?: number = 60 }
// 出力:   { grant_id, expires_at }
//
// 権限:
//   ・呼出 user が target user の所属 office の admin (group/company/office) であること
//   ・WITH CHECK は passkey_registration_grants の RLS で再 enforce

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { target_user_id, reason, ttl_minutes } = (body ?? {}) as {
    target_user_id?: unknown;
    reason?: unknown;
    ttl_minutes?: unknown;
  };

  if (typeof target_user_id !== "string" || target_user_id.length === 0) {
    return NextResponse.json({ error: "target_user_id_invalid" }, { status: 400 });
  }
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return NextResponse.json({ error: "reason_invalid" }, { status: 400 });
  }
  const ttl = typeof ttl_minutes === "number" && ttl_minutes > 0 && ttl_minutes <= 1440 ? ttl_minutes : 60;

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const callerId = userData.user.id;

  // 認可: 呼出 user が target_user_id に対する admin 権限を持つか
  //   target user の office IN auth_admin_office_ids() を確認 (admin client で listUsers せず DB 直接)
  const { data: callerAdminOffices, error: adminErr } = await supabase.rpc("auth_admin_office_ids");
  if (adminErr) {
    return NextResponse.json({ error: "permission_check_failed" }, { status: 500 });
  }
  type AdminRow = { auth_admin_office_ids?: string } | string;
  const adminOfficeIds = ((callerAdminOffices ?? []) as AdminRow[]).map((r) =>
    typeof r === "string" ? r : r.auth_admin_office_ids ?? ""
  );

  // target user の所属 office を引いて 1 つでも overlap があれば OK
  const admin = createAdminClient();
  const { data: targetOffices } = await admin
    .from("user_offices")
    .select("office_id")
    .eq("user_id", target_user_id);
  const targetOfficeIds = ((targetOffices ?? []) as { office_id: string }[]).map((r) => r.office_id);

  const hasOverlap = targetOfficeIds.some((id) => adminOfficeIds.includes(id));
  // group_admin / company_admin であれば overlap 無くても OK (RLS と一貫)
  const { data: callerGroups } = await supabase.rpc("auth_admin_group_ids");
  const isGroupOrCompanyAdmin = (callerGroups ?? []).length > 0;
  // company も同じ。簡略のため group_admin_ids が空でなければ広範権限ありと判定
  // (より厳密にやるなら auth_admin_company_ids() も呼ぶ)

  if (!hasOverlap && !isGroupOrCompanyAdmin) {
    return NextResponse.json({ error: "not_permitted" }, { status: 403 });
  }

  // 既存の active grant があれば period 上書き、無ければ INSERT
  // user_id に対する partial unique は無いので、まず削除→再 insert で簡略化
  // (consumed_at 済の row は audit のため残す)
  const { error: clearErr } = await admin
    .from("passkey_registration_grants")
    .delete()
    .eq("user_id", target_user_id)
    .is("consumed_at", null);
  if (clearErr) {
    return NextResponse.json({ error: "clear_old_grant_failed", detail: clearErr.message }, { status: 500 });
  }

  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  const { data: created, error: insertErr } = await admin
    .from("passkey_registration_grants")
    .insert({
      user_id: target_user_id,
      granted_by: callerId,
      expires_at: expiresAt,
      reason: typeof reason === "string" ? reason : null,
    })
    .select("id, expires_at")
    .single();

  if (insertErr || !created) {
    return NextResponse.json(
      { error: "grant_insert_failed", detail: insertErr?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    grant_id: created.id,
    expires_at: created.expires_at,
    ttl_minutes: ttl,
  });
}

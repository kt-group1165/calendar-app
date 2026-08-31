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
    // app 列は migration 未適用の環境では存在しないので "*" で取る
    // (列名を並べると未適用時に 42703 で落ちる)
    .select("*")
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
  //   ただし上限を 2 台に制限する (社用 + 私用 スマホを想定)。既に 2 台 approved な
  //   user の 3 台目承認は 409 を返し、admin に既存端末の revoke を促す。
  //   無関係な PC からのログインを防ぐため、緩めすぎないように。
  //
  // 2026-08-31 監査での是正: この 2 台を**全アプリ通算**で数えていた。
  //   kt_device_id は document.cookie = ドメイン単位なので、同じ PC でも
  //   kt-calendar / kt-kaigo / kt-yougu / kt-kyuyo で別々の device_id になる。
  //   = 1 人が 3 つ目のアプリを使った時点で必ず 409 になっていた
  //     (domen@ は MASTER_USER_EMAILS で trust check ごと bypass するので
  //      今まで表面化していなかった)。
  //   「社用 + 私用スマホの 2 台」という意図はアプリ単位で数えれば保たれるので、
  //   同じ app の行だけを数える。
  //   ⚠ 恒久策は 4 アプリを kt-group.co.jp のサブドメインに載せて cookie を
  //     共有すること。そうすれば device_id が 1 つになりこの列は不要になる。
  const APPROVED_DEVICE_LIMIT = 2;
  let limitQuery = admin
    .from("trusted_devices")
    .select("*", { count: "exact", head: true })
    .eq("user_id", row.user_id)
    .eq("status", "approved")
    .neq("id", device_id_uuid);
  // app 列は migrations/trusted_devices_app_scope.sql で追加。
  // 未適用の環境では row.app が undefined になるので従来どおり全体で数える。
  const targetApp = (row as { app?: string | null }).app ?? null;
  if (targetApp !== null) {
    limitQuery = limitQuery.eq("app", targetApp);
  }
  const { count: othersApprovedCount, error: limitErr } = await limitQuery;
  if (limitErr && limitErr.code !== "42703") {
    return NextResponse.json(
      { error: "limit_check_failed", detail: limitErr.message },
      { status: 500 }
    );
  }
  if ((othersApprovedCount ?? 0) >= APPROVED_DEVICE_LIMIT) {
    return NextResponse.json(
      {
        error: "approved_limit_exceeded",
        message: targetApp
          ? `${targetApp} の承認済み端末は最大 ${APPROVED_DEVICE_LIMIT} 台までです。先にこのアプリの既存端末を 1 台 revoke (拒否) してから承認してください。`
          : `承認済み端末は最大 ${APPROVED_DEVICE_LIMIT} 台までです。先に既存の端末を 1 台 revoke (拒否) してから承認してください。`,
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

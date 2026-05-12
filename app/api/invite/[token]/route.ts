import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { isValidLoginId, loginIdToSyntheticEmail } from "@/lib/login_id";
import { verifyPassword } from "@/lib/invitations";

// /api/invite/[token]
//
// GET  : token の妥当性を検証して、consume 画面に必要な metadata を返す。
//        invitee は未ログインなので service_role でアクセス。token 自体が
//        unguessable な認証要素として機能する。
//
// POST : invitee が initial_password と login_id, new_password を入力して
//        consume する。原子的に staff_invitations を消費 → auth.users 作成
//        → members 作成（必要なら）→ user_offices INSERT。
//
// 注意:
//   - 失敗時のメッセージは可能な限り曖昧にする（token 存在の有無を
//     オラクルしない）。404 / 410 / 401 の使い分けに留める。
//   - 順序: 「先に staff_invitations を consumed にマーク」してから auth
//     user 作成。途中失敗時は招待が "burned" になるが、admin が再発行
//     すれば良い。double-consume よりは遥かに軽い帰結。

const DEFAULT_MEMBER_COLOR = "#6366f1";

type InvitationRow = {
  token: string;
  display_name: string;
  office_id: string;
  role: "office_admin" | "member";
  member_id: string | null;
  initial_password_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_by: string | null;
};

type RouteContext = { params: Promise<{ token: string }> };

// ────────────────────────────────────────────────────────────────────
// GET: invitation metadata（consume 画面の表示用）
// ────────────────────────────────────────────────────────────────────
export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createAdminClient();

  const { data: inv } = await admin
    .from("staff_invitations")
    .select("display_name, office_id, role, expires_at, consumed_at, login_id")
    .eq("token", token)
    .maybeSingle();

  if (!inv || inv.consumed_at !== null || new Date(inv.expires_at) <= new Date()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // office 名 + tenant 名（resource embedding は明示 FK 不在のため使わず別引き）
  const { data: office } = await admin
    .from("offices")
    .select("name, tenant_id")
    .eq("id", inv.office_id)
    .maybeSingle();

  const officeRow = office as { name: string | null; tenant_id: string | null } | null;
  let tenantName: string | null = null;
  if (officeRow?.tenant_id) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("name")
      .eq("id", officeRow.tenant_id)
      .maybeSingle();
    tenantName = (tenant as { name?: string } | null)?.name ?? null;
  }

  return NextResponse.json({
    display_name: inv.display_name,
    role: inv.role,
    office_name: officeRow?.name ?? null,
    tenant_name: tenantName,
    expires_at: inv.expires_at,
    // 招待発行時に admin が login_id を確定済の場合は invitee に readonly 表示。
    // null の場合は従来挙動 (invitee が consume 時に決める)。
    login_id: (inv as { login_id?: string | null }).login_id ?? null,
  });
}

// ────────────────────────────────────────────────────────────────────
// POST: consume
// ────────────────────────────────────────────────────────────────────
export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { initial_password, login_id: bodyLoginId, new_password, device_id: bodyDeviceId, device_label: bodyDeviceLabel } = (body ?? {}) as {
    initial_password?: unknown;
    login_id?: unknown;
    new_password?: unknown;
    device_id?: unknown;
    device_label?: unknown;
  };

  if (typeof initial_password !== "string" || initial_password.length === 0) {
    return NextResponse.json({ error: "initial_password_required" }, { status: 400 });
  }
  // login_id は invitation 側に確定済の場合はそちらを優先 (下で判定)。
  // body の login_id は invitation 側が NULL の場合の fallback。
  if (typeof new_password !== "string" || new_password.length < 8 || new_password.length > 128) {
    return NextResponse.json({ error: "new_password_invalid" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1) invitation 取得 + 妥当性検証 ----------------------------------
  const { data: rawInv } = await admin
    .from("staff_invitations")
    .select("token, display_name, office_id, role, member_id, login_id, initial_password_hash, expires_at, consumed_at, created_by")
    .eq("token", token)
    .maybeSingle();

  const inv = rawInv as (InvitationRow & { login_id?: string | null }) | null;
  if (!inv || inv.consumed_at !== null || new Date(inv.expires_at) <= new Date()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 1b) 確定 login_id 決定: invitation 側が優先、無ければ body の login_id を使う
  const login_id = inv.login_id ?? (typeof bodyLoginId === "string" ? bodyLoginId : "");
  if (!isValidLoginId(login_id)) {
    return NextResponse.json({ error: "login_id_invalid" }, { status: 400 });
  }

  // 2) initial_password 検証 ----------------------------------------
  const passOk = await verifyPassword(initial_password, inv.initial_password_hash);
  if (!passOk) {
    return NextResponse.json({ error: "initial_password_mismatch" }, { status: 401 });
  }

  // 3) staff_invitations を原子的に consume へ移行 ------------------
  //    WHERE consumed_at IS NULL を CAS 条件として、二重消費を防ぐ。
  const { data: claimed, error: claimError } = await admin
    .from("staff_invitations")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token", token)
    .is("consumed_at", null)
    .select("token");
  if (claimError || !claimed || claimed.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 以降の失敗は invitation "burned" のまま（admin が再発行）。

  // 4) office から tenant_id を解決 ---------------------------------
  const { data: office } = await admin
    .from("offices")
    .select("tenant_id")
    .eq("id", inv.office_id)
    .maybeSingle();

  const tenantId = (office as { tenant_id?: string } | null)?.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: "office_not_found" }, { status: 500 });
  }

  // 5) auth.users に新規ユーザ作成 -----------------------------------
  const syntheticEmail = loginIdToSyntheticEmail(login_id);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: new_password,
    email_confirm: true,
    user_metadata: { display_name: inv.display_name, login_id },
  });
  if (createError || !created?.user) {
    // login_id 衝突など。ユーザに分かるメッセージを返す。
    const isDup = /already.*registered|duplicate|unique/i.test(createError?.message ?? "");
    return NextResponse.json(
      { error: isDup ? "login_id_taken" : "create_user_failed", detail: createError?.message },
      { status: isDup ? 409 : 500 }
    );
  }
  const newUserId = created.user.id;

  // 6) member 行の解決（既存リンク優先 / なければ auto-create）-------
  let memberId = inv.member_id;
  // 新規 INSERT した場合のみ true (rollback 対象判定)
  let newMemberCreated = false;
  if (!memberId) {
    const { data: nextOrder } = await admin
      .from("members")
      .select("sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: false, nullsFirst: false })
      .limit(1);
    const nextSortOrder = (nextOrder?.[0]?.sort_order ?? 0) + 1;

    // Phase 9 close: members.office_id は DROP 済 → office 紐付けは member_offices junction で行う
    // (line 235 の member_offices.insert がそれを担当)
    const { data: newMember, error: memberError } = await admin
      .from("members")
      .insert({
        name: inv.display_name,
        color: DEFAULT_MEMBER_COLOR,
        sort_order: nextSortOrder,
        tenant_id: tenantId,
      })
      .select("id")
      .single();
    if (memberError || !newMember) {
      // rollback: 直前に作った auth user を削除 (zombie 防止)
      //   staff_invitations.consumed_at は burned のまま (admin が再発行する想定)
      await admin.auth.admin.deleteUser(newUserId).catch((e) => {
        console.warn(`[invite] rollback deleteUser ${newUserId} failed`, e);
      });
      return NextResponse.json(
        { error: "member_create_failed", detail: memberError?.message },
        { status: 500 }
      );
    }
    memberId = newMember.id;
    newMemberCreated = true;
  }

  // 7) user_offices に割当行 INSERT ---------------------------------
  const { error: assignError } = await admin.from("user_offices").insert({
    user_id: newUserId,
    office_id: inv.office_id,
    role: inv.role,
    member_id: memberId,
    is_primary: true,
  });
  if (assignError) {
    // rollback: 新規作成 member + auth user を削除 (zombie 防止)
    if (newMemberCreated && memberId) {
      const { error: delMemberErr } = await admin.from("members").delete().eq("id", memberId);
      if (delMemberErr) console.warn(`[invite] rollback delete members ${memberId} failed`, delMemberErr);
    }
    await admin.auth.admin.deleteUser(newUserId).catch((e) => {
      console.warn(`[invite] rollback deleteUser ${newUserId} failed`, e);
    });
    return NextResponse.json(
      { error: "assign_failed", detail: assignError.message },
      { status: 500 }
    );
  }

  // 7b) Phase 9: member_offices junction にも primary 行 INSERT ------
  //     (members.office_id は当面残るが、新コードは junction を read source に)
  if (memberId) {
    await admin
      .from("member_offices")
      .insert({ member_id: memberId, office_id: inv.office_id, is_primary: true });
    // 既存重複は ON CONFLICT 相当、エラーは無視 (junction が無い旧 schema の保険)
  }

  // 7c) Phase 9: members.auth_user_id を埋める ----------------------
  if (memberId) {
    await admin
      .from("members")
      .update({ auth_user_id: newUserId })
      .eq("id", memberId)
      .is("auth_user_id", null);
    // 既に紐付いてれば skip。column 不在時は schema cache miss で error → 無視
  }

  // 7d) Phase 9: payroll_employees に行を作成 (既存無ければ) ---------
  //     office.service_type に関わらず全 staff を payroll_employees に登録 (= 全員給与対象)。
  //     payroll_offices は master offices.id → payroll 内 id を mapping で解決。
  await ensurePayrollEmployee(admin, {
    authUserId: newUserId,
    masterOfficeId: inv.office_id,
    name: inv.display_name,
  });

  // 7e) Phase 11c: 招待 consume と同時にこの端末を auto-trust ---------
  //     body.device_id が来ていれば、その device を approved な
  //     trusted_devices に登録。これによりスタッフは admin の再承認
  //     を待たずに、初回ログイン後すぐシステムを使える。
  //     設計判断: 招待 URL を渡した admin が「最初の 1 端末を信頼する」
  //     と見なせる (= admin が直接スタッフに URL を渡しているという前提)。
  const consumeDeviceId = typeof bodyDeviceId === "string" ? bodyDeviceId : null;
  const consumeDeviceLabel = typeof bodyDeviceLabel === "string" ? bodyDeviceLabel : null;
  if (consumeDeviceId) {
    const ua = request.headers.get("user-agent") ?? null;
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;
    const nowIso = new Date().toISOString();
    await admin.from("trusted_devices").upsert(
      {
        user_id: newUserId,
        device_id: consumeDeviceId,
        device_label: consumeDeviceLabel,
        status: "approved",
        approved_at: nowIso,
        approved_by: inv.created_by ?? newUserId,   // 招待発行 admin を approver として記録
        last_seen_at: nowIso,
        first_seen_ua: ua,
        first_seen_ip: ip,
        revoked_at: null,
      },
      { onConflict: "user_id,device_id" }
    );
  }

  // 8) staff_invitations に consumed_user_id を後追いで埋める --------
  await admin
    .from("staff_invitations")
    .update({ consumed_user_id: newUserId })
    .eq("token", token);

  return NextResponse.json({
    ok: true,
    email: syntheticEmail,
    login_id,
  });
}

// ────────────────────────────────────────────────────────────────────
// Phase 9: payroll_employees 自動作成ヘルパー
// ────────────────────────────────────────────────────────────────────
//   - master offices.id → payroll_offices.id (link 済) を解決
//   - employee_number は YYYYMMDD + 同日内連番 (2 桁) で生成
//   - 失敗は warn ログのみ (招待 consume の主路は成功扱い)
async function ensurePayrollEmployee(
  admin: ReturnType<typeof createAdminClient>,
  params: { authUserId: string; masterOfficeId: string; name: string }
): Promise<void> {
  const { authUserId, masterOfficeId, name } = params;

  const { data: existing } = await admin
    .from("payroll_employees")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (existing) return;

  const { data: payrollOffice } = await admin
    .from("payroll_offices")
    .select("id")
    .eq("office_id", masterOfficeId)
    .maybeSingle();
  if (!payrollOffice) {
    console.warn(`[invite] payroll_offices not linked to master office ${masterOfficeId}; payroll_employees skipped for ${name}`);
    return;
  }

  // employee_number: YYYYMMDD + 同日内連番 2 桁
  const today = new Date();
  const yyyymmdd =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const { data: sameDay } = await admin
    .from("payroll_employees")
    .select("employee_number")
    .like("employee_number", `${yyyymmdd}%`);
  const seq = (sameDay?.length ?? 0) + 1;
  const employeeNumber = `${yyyymmdd}${String(seq).padStart(2, "0")}`;

  const { error } = await admin.from("payroll_employees").insert({
    name,
    office_id: (payrollOffice as { id: string }).id,
    auth_user_id: authUserId,
    employee_number: employeeNumber,
    employment_status: "在職者",
    // role_type / salary_type / job_type / transport_type は default 値
    // 詳細 (hire_date / 給与額 等) は payroll-app UI で個別入力
  });
  if (error) {
    console.warn(`[invite] payroll_employees insert failed for ${name}: ${error.message}`);
  }
}

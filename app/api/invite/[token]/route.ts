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
    .select("display_name, office_id, role, expires_at, consumed_at")
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

  const { initial_password, login_id, new_password } = (body ?? {}) as {
    initial_password?: unknown;
    login_id?: unknown;
    new_password?: unknown;
  };

  if (typeof initial_password !== "string" || initial_password.length === 0) {
    return NextResponse.json({ error: "initial_password_required" }, { status: 400 });
  }
  if (typeof login_id !== "string" || !isValidLoginId(login_id)) {
    return NextResponse.json({ error: "login_id_invalid" }, { status: 400 });
  }
  if (typeof new_password !== "string" || new_password.length < 8 || new_password.length > 128) {
    return NextResponse.json({ error: "new_password_invalid" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1) invitation 取得 + 妥当性検証 ----------------------------------
  const { data: rawInv } = await admin
    .from("staff_invitations")
    .select("token, display_name, office_id, role, member_id, initial_password_hash, expires_at, consumed_at")
    .eq("token", token)
    .maybeSingle();

  const inv = rawInv as InvitationRow | null;
  if (!inv || inv.consumed_at !== null || new Date(inv.expires_at) <= new Date()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
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
  if (!memberId) {
    const { data: nextOrder } = await admin
      .from("members")
      .select("sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: false, nullsFirst: false })
      .limit(1);
    const nextSortOrder = (nextOrder?.[0]?.sort_order ?? 0) + 1;

    const { data: newMember, error: memberError } = await admin
      .from("members")
      .insert({
        name: inv.display_name,
        color: DEFAULT_MEMBER_COLOR,
        sort_order: nextSortOrder,
        office_id: inv.office_id,
        tenant_id: tenantId,
      })
      .select("id")
      .single();
    if (memberError || !newMember) {
      return NextResponse.json(
        { error: "member_create_failed", detail: memberError?.message },
        { status: 500 }
      );
    }
    memberId = newMember.id;
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
    return NextResponse.json(
      { error: "assign_failed", detail: assignError.message },
      { status: 500 }
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

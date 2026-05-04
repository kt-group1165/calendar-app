import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  generateInitialPassword,
  generateToken,
  hashPassword,
} from "@/lib/invitations";

// POST /api/admin/invite-staff
//
// office_admin / company_admin / group_admin が新しいスタッフを招待する。
// 入力:   { display_name, office_id, role, member_id? }
// 出力:   { token, invite_url, initial_password, expires_at }
//
// 権限検証:
//   - 呼出ユーザが auth セッション持ち
//   - 指定 office_id が auth_visible_office_ids() に含まれる（= 招待者がその
//     office に対する管理権限を持っている）
//
// 注: staff_invitations への INSERT は authenticated 経路（cookies の anon
//     client）で行うので、staff_invitations_admin_manage policy が改めて
//     `office_id IN visible AND created_by = auth.uid()` を enforce する。
//     ここがサーバ事前チェックの defense in depth。

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { display_name, office_id, role, member_id } = (body ?? {}) as {
    display_name?: unknown;
    office_id?: unknown;
    role?: unknown;
    member_id?: unknown;
  };

  if (typeof display_name !== "string" || display_name.trim().length === 0 || display_name.length > 64) {
    return NextResponse.json({ error: "display_name_invalid" }, { status: 400 });
  }
  if (typeof office_id !== "string" || office_id.length === 0) {
    return NextResponse.json({ error: "office_id_invalid" }, { status: 400 });
  }
  if (role !== "office_admin" && role !== "member") {
    return NextResponse.json({ error: "role_invalid" }, { status: 400 });
  }
  if (member_id !== undefined && member_id !== null && typeof member_id !== "string") {
    return NextResponse.json({ error: "member_id_invalid" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const callerId = userData.user.id;

  // 事前チェック: 呼出ユーザが指定 office に対して admin 権限を持つか。
  //   auth_admin_office_ids() = group_admin / company_admin / office_admin
  //   が招待発行可能な office 集合（member は含まない）。
  //   defense in depth: RLS policy も同関数で enforce している。
  const { data: adminRows, error: adminError } = await supabase.rpc(
    "auth_admin_office_ids"
  );
  if (adminError) {
    return NextResponse.json({ error: "permission_check_failed" }, { status: 500 });
  }
  type AdminRow = { auth_admin_office_ids?: string } | string;
  const adminOfficeIds = ((adminRows ?? []) as AdminRow[]).map((r) =>
    typeof r === "string" ? r : r.auth_admin_office_ids ?? ""
  );
  if (!adminOfficeIds.includes(office_id)) {
    return NextResponse.json({ error: "office_not_allowed" }, { status: 403 });
  }

  // 招待発行
  const token = generateToken();
  const initialPassword = generateInitialPassword();
  const initialPasswordHash = await hashPassword(initialPassword);

  const { error: insertError } = await supabase.from("staff_invitations").insert({
    token,
    display_name: display_name.trim(),
    office_id,
    role,
    member_id: member_id ?? null,
    initial_password_hash: initialPasswordHash,
    created_by: callerId,
    // expires_at は DB default (NOW() + 7d) に任せる
  });
  if (insertError) {
    // policy 違反 / FK 違反など。原因を詳細には返さない。
    return NextResponse.json(
      { error: "insert_failed", detail: insertError.message },
      { status: 400 }
    );
  }

  // 戻り値の expires_at を取得（クライアントに表示するため）
  const { data: row } = await supabase
    .from("staff_invitations")
    .select("expires_at")
    .eq("token", token)
    .maybeSingle();

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  const inviteUrl = `${origin}/invite/${token}`;

  return NextResponse.json({
    token,
    invite_url: inviteUrl,
    initial_password: initialPassword,
    expires_at: row?.expires_at ?? null,
  });
}

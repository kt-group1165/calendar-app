import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// ユーザー招待 API。
// 呼び出し元が指定テナントの master である場合のみ実行。
// service_role キーで auth.admin.inviteUserByEmail を叩き、raw_app_meta_data に
// テナント情報を入れておく → トリガー `handle_new_auth_user` が user_tenants に自動挿入。
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // 1. 呼び出しユーザーを検証
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { email, tenantId, role, memberId } = body as {
    email?: string;
    tenantId?: string;
    role?: "master" | "member";
    memberId?: string | null;
  };
  if (!email || !tenantId) {
    return NextResponse.json({ error: "email と tenantId は必須です" }, { status: 400 });
  }
  const finalRole = role === "master" ? "master" : "member";

  // 2. 呼び出しユーザーが master か確認
  const { data: caller } = await supabase
    .from("user_tenants")
    .select("role")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!caller || caller.role !== "master") {
    return NextResponse.json({ error: "マスター権限が必要です" }, { status: 403 });
  }

  // 3. service_role で招待
  const admin = createAdminClient();
  const origin = new URL(req.url).origin;

  // 既に auth.users に居るか確認
  const { data: existing } = await admin.auth.admin.listUsers();
  const existingUser = existing?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existingUser) {
    // 既存ユーザー → user_tenants に行を直接追加
    const { error: insertError } = await admin
      .from("user_tenants")
      .upsert({
        user_id: existingUser.id,
        tenant_id: tenantId,
        role: finalRole,
        member_id: memberId ?? null,
      }, { onConflict: "user_id,tenant_id" });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, kind: "added_existing" });
  }

  // 新規招待
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback`,
    data: {
      invite_tenant_id: tenantId,
      invite_role: finalRole,
      invite_member_id: memberId ?? null,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 注意：inviteUserByEmail の data は raw_user_meta_data に入るが、
  // トリガーが見るのは raw_app_meta_data。そのため app_metadata も別途設定する。
  const invitedId = data.user?.id;
  if (invitedId) {
    await admin.auth.admin.updateUserById(invitedId, {
      app_metadata: {
        invite_tenant_id: tenantId,
        invite_role: finalRole,
        invite_member_id: memberId ?? null,
      },
    });
    // ただしユーザー作成は既にトリガーで処理済み。app_metadata はあくまで記録用。
    // 確実に user_tenants を入れるため、ここでも upsert する：
    await admin
      .from("user_tenants")
      .upsert({
        user_id: invitedId,
        tenant_id: tenantId,
        role: finalRole,
        member_id: memberId ?? null,
      }, { onConflict: "user_id,tenant_id" });
  }

  return NextResponse.json({ success: true, kind: "invited" });
}

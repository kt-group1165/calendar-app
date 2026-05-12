import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { isValidLoginId, loginIdToSyntheticEmail } from "@/lib/login_id";

// POST /api/login
//
// Phase 11: パスワードログインの passkey 排他チェック (方式 A)
//
// 仕様:
//   1. login_id (または実 email) + password を受ける
//   2. 該当 user に passkey が 1 つ以上登録されていれば PW ログインを拒否
//      (= passkey 必須運用に強制移行)
//   3. ただし user_metadata.password_login_emergency = true なら例外的に許可
//      (admin が緊急時に一時許可を出した状態)
//   4. パス時は emergency フラグを自動 clear (= one-shot)
//
// 注: 既存の supabase.auth.signInWithPassword (client 直叩き) を完全に置換するため、
//     login page から本 API を呼ぶように改修すること。

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { identifier, password } = (body ?? {}) as {
    identifier?: unknown;
    password?: unknown;
  };

  if (typeof identifier !== "string" || identifier.trim().length === 0) {
    return NextResponse.json({ error: "identifier_required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "password_required" }, { status: 400 });
  }

  // identifier → email 解決
  const trimmed = identifier.trim();
  let email: string | null = null;
  if (trimmed.includes("@")) {
    email = trimmed;
  } else if (isValidLoginId(trimmed)) {
    email = loginIdToSyntheticEmail(trimmed);
  }
  if (!email) {
    return NextResponse.json({ error: "credentials_invalid" }, { status: 401 });
  }

  // user 解決 (service_role で auth.users を listUsers)
  //   - 大規模 user 環境では filter API が望ましいが、現状の規模 (~1000+) なら
  //     listUsers の per-page 1000 で十分。後で getUserByEmail 等に置換可。
  const admin = createAdminClient();
  const { data: usersList, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  const targetUser = (usersList?.users ?? []).find((u) => u.email === email);

  // user が居なくても情報をオラクルしないため、passkey 判定はスキップして
  // 通常の signInWithPassword に流す (= "credentials_invalid" が返る)。
  if (targetUser) {
    // Phase 11: passkey 排他チェック
    const { data: passkeys } = await admin
      .from("passkey_credentials")
      .select("id")
      .eq("user_id", targetUser.id)
      .limit(1);
    const hasPasskey = (passkeys ?? []).length > 0;

    const emergencyAllowed =
      (targetUser.user_metadata as Record<string, unknown> | null | undefined)?.password_login_emergency === true;

    if (hasPasskey && !emergencyAllowed) {
      return NextResponse.json(
        {
          error: "passkey_required",
          message: "この account には Passkey が登録されています。Passkey でログインしてください。",
        },
        { status: 403 }
      );
    }
  }

  // 認証実行 (server client で cookies に session を書く)
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    return NextResponse.json({ error: "credentials_invalid" }, { status: 401 });
  }

  // 緊急フラグを consume (one-shot)
  if (targetUser) {
    const meta = (targetUser.user_metadata ?? {}) as Record<string, unknown>;
    if (meta.password_login_emergency === true) {
      await admin.auth.admin.updateUserById(targetUser.id, {
        user_metadata: { ...meta, password_login_emergency: false },
      });
    }
  }

  return NextResponse.json({ ok: true });
}

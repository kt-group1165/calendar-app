import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createAdminClient } from "@/lib/supabase-server";
import { getRpInfo } from "@/lib/passkey";
import { isValidLoginId, loginIdToSyntheticEmail } from "@/lib/login_id";

// POST /api/passkey/auth/begin
// body: { identifier?: string }  // login_id or email; 省略時は usernameless (resident key) flow
// 認証 options を返す。challenge は passkey_challenges に保存。

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const identifier: string | undefined = body?.identifier?.trim() || undefined;

  const admin = createAdminClient();

  // login_id / email から auth.users を解決 (任意)
  let userId: string | null = null;
  let email: string | null = null;
  if (identifier) {
    email = identifier.includes("@")
      ? identifier
      : isValidLoginId(identifier)
      ? loginIdToSyntheticEmail(identifier)
      : null;
    if (!email) {
      return NextResponse.json({ error: "invalid identifier" }, { status: 400 });
    }
    // service_role でユーザー存在確認
    const { data: usersResp } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const u = usersResp.users.find((x) => x.email === email);
    if (u) userId = u.id;
    // user 不在でも errror は返さない (列挙攻撃防止のため、challenge は出す)
  }

  // allowCredentials: identifier 指定時のみ絞り込み (省略時は usernameless)
  let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;
  if (userId) {
    const { data: creds } = await admin
      .from("passkey_credentials")
      .select("credential_id, transports")
      .eq("user_id", userId);
    allowCredentials = (creds ?? []).map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as AuthenticatorTransport[] | undefined,
    }));
  }

  const { rpID } = await getRpInfo();

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: "preferred",
  });

  // challenge を保存 (login_id を一緒に持っておく = identifier 経由の verify で参照可)
  await admin.from("passkey_challenges").insert({
    user_id: userId,
    login_id: identifier ?? null,
    challenge: options.challenge,
    challenge_type: "authentication",
  });

  return NextResponse.json({ options });
}

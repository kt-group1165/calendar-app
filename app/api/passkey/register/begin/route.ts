import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getRpInfo } from "@/lib/passkey";

// POST /api/passkey/register/begin
// 認証済み user が新しい passkey を登録するための options を返す。
// challenge は passkey_challenges に保存し、complete 時に検証。

export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = userData.user;

  const admin = createAdminClient();

  // 既存 credentials を excludeCredentials に渡す (二重登録防止)
  const { data: existing } = await admin
    .from("passkey_credentials")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  // Phase 11: 1 端末固定ポリシー
  //   既存 passkey が 1 件でもあれば、admin の有効な grant が無い限り 2 台目登録を拒否
  if ((existing ?? []).length > 0) {
    const { data: grant } = await admin
      .from("passkey_registration_grants")
      .select("id")
      .eq("user_id", user.id)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!grant) {
      return NextResponse.json(
        {
          error: "additional_registration_not_permitted",
          message: "既に Passkey が登録されています。追加登録には管理者の許可が必要です。",
        },
        { status: 403 }
      );
    }
  }

  const { rpID, rpName } = await getRpInfo();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email ?? user.id,
    userDisplayName: (user.user_metadata?.display_name as string) ?? user.email ?? "",
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // challenge を保存 (5 min expiry はカラム default)
  // 既存の registration challenge は破棄
  await admin
    .from("passkey_challenges")
    .delete()
    .eq("user_id", user.id)
    .eq("challenge_type", "registration");

  const { error: insertErr } = await admin.from("passkey_challenges").insert({
    user_id: user.id,
    challenge: options.challenge,
    challenge_type: "registration",
  });
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ options });
}

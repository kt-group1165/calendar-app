import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import { createAdminClient } from "@/lib/supabase-server";
import { getRpInfo, base64ToUint8Array } from "@/lib/passkey";

// POST /api/passkey/auth/complete
// body: { response: AuthenticationResponseJSON }
// 検証成功で magic link token (hashed_token) を生成し、client が verifyOtp で session 化する。

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const response: AuthenticationResponseJSON | undefined = body?.response;
  if (!response) {
    return NextResponse.json({ error: "missing response" }, { status: 400 });
  }

  const admin = createAdminClient();

  // credential_id で credential row を引く (= どの user か特定)
  const { data: cred } = await admin
    .from("passkey_credentials")
    .select("id, user_id, credential_id, public_key, counter, transports")
    .eq("credential_id", response.id)
    .maybeSingle();

  if (!cred) {
    return NextResponse.json({ error: "unknown credential" }, { status: 400 });
  }

  // 当該 user_id の最新 authentication challenge を取得
  const { data: chal } = await admin
    .from("passkey_challenges")
    .select("challenge, expires_at")
    .or(`user_id.eq.${cred.user_id},user_id.is.null`)
    .eq("challenge_type", "authentication")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!chal) {
    return NextResponse.json({ error: "challenge expired or missing" }, { status: 400 });
  }

  const { rpID, origin } = await getRpInfo();

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: chal.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: base64ToUint8Array(cred.public_key),
        counter: Number(cred.counter),
        transports: (cred.transports ?? undefined) as AuthenticatorTransport[] | undefined,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  // counter 更新 + last_used_at
  await admin
    .from("passkey_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", cred.id);

  // 認証 challenge cleanup (該当行のみ)
  await admin
    .from("passkey_challenges")
    .delete()
    .or(`user_id.eq.${cred.user_id},user_id.is.null`)
    .eq("challenge_type", "authentication");

  // session 化: admin.generateLink で magiclink を発行 → client で verifyOtp
  const { data: userResp, error: userErr } = await admin.auth.admin.getUserById(cred.user_id);
  if (userErr || !userResp.user?.email) {
    return NextResponse.json({ error: "user lookup failed" }, { status: 500 });
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userResp.user.email,
  });
  if (linkErr || !linkData.properties?.hashed_token) {
    return NextResponse.json({ error: linkErr?.message ?? "link generation failed" }, { status: 500 });
  }

  return NextResponse.json({
    verified: true,
    token_hash: linkData.properties.hashed_token,
    email: userResp.user.email,
  });
}

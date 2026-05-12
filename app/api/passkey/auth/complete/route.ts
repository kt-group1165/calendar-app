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

  // Phase 11c: trusted_devices check
  //   device_id (client cookie kt_device_id) を読み、approved 状態なら session 発行可。
  //   未登録なら pending row を作成して "approval_required" を返す。
  //   revoked なら拒否。
  const bodyDeviceId = typeof body?.device_id === "string" ? body.device_id : null;
  const bodyDeviceLabel = typeof body?.device_label === "string" ? body.device_label : null;
  if (!bodyDeviceId) {
    return NextResponse.json(
      { error: "device_id_missing", message: "デバイス識別子が取得できませんでした。Cookie 設定を有効にしてください。" },
      { status: 400 }
    );
  }
  const ua = req.headers.get("user-agent") ?? null;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const { data: trustRow } = await admin
    .from("trusted_devices")
    .select("status")
    .eq("user_id", cred.user_id)
    .eq("device_id", bodyDeviceId)
    .maybeSingle();
  if (!trustRow) {
    // 初見端末 → pending row を作成して承認待ち
    await admin.from("trusted_devices").insert({
      user_id: cred.user_id,
      device_id: bodyDeviceId,
      device_label: bodyDeviceLabel,
      status: "pending",
      first_seen_ua: ua,
      first_seen_ip: ip,
    });
    return NextResponse.json(
      {
        verified: true,
        status: "approval_required",
        message:
          "新しい端末からのログインです。管理者の承認をお待ちください。承認されたら再度お試しください。",
      },
      { status: 202 }
    );
  }
  if (trustRow.status === "revoked") {
    return NextResponse.json(
      {
        verified: true,
        status: "device_revoked",
        message: "この端末は管理者により無効化されています。管理者に連絡してください。",
      },
      { status: 403 }
    );
  }
  if (trustRow.status === "pending") {
    // 既に pending: last_seen_at を更新するだけ
    await admin
      .from("trusted_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", cred.user_id)
      .eq("device_id", bodyDeviceId);
    return NextResponse.json(
      {
        verified: true,
        status: "approval_required",
        message: "管理者の承認待ちです。承認されたら再度お試しください。",
      },
      { status: 202 }
    );
  }
  // status === 'approved' → last_seen_at 更新 + session 発行へ
  await admin
    .from("trusted_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", cred.user_id)
    .eq("device_id", bodyDeviceId);

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

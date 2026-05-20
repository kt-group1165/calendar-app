import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/types";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getRpInfo, uint8ArrayToBase64 } from "@/lib/passkey";

// POST /api/passkey/register/complete
// body: { response: RegistrationResponseJSON, deviceName?: string }
// 検証成功で passkey_credentials に保存し、challenge を削除する。

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = userData.user;

  const body = await req.json().catch(() => null);
  const response: RegistrationResponseJSON | undefined = body?.response;
  const deviceName: string | undefined = body?.deviceName?.trim() || undefined;
  if (!response) {
    return NextResponse.json({ error: "missing response" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: chal } = await admin
    .from("passkey_challenges")
    .select("challenge, expires_at")
    .eq("user_id", user.id)
    .eq("challenge_type", "registration")
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
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: chal.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;

  // Phase 11c: syncable は許容、端末縛りは trusted_devices で行う
  const { error: insertErr } = await admin.from("passkey_credentials").insert({
    user_id: user.id,
    credential_id: credential.id,
    public_key: uint8ArrayToBase64(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? null,
    device_name: deviceName ?? null,
    aaguid: aaguid ?? null,
    backup_eligible: credentialDeviceType === "multiDevice",
    backup_state: credentialBackedUp,
  });
  if (insertErr) {
    if (insertErr.code === "23505") {
      // unique violation = 既に登録済み
      return NextResponse.json({ error: "already registered" }, { status: 409 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // challenge cleanup
  await admin
    .from("passkey_challenges")
    .delete()
    .eq("user_id", user.id)
    .eq("challenge_type", "registration");

  // Phase 11: 2 台目登録だった場合は grant を consume (= 一回限りで失効)
  //   begin で existing > 0 だった場合のみ grant が消費される。1 台目登録時は no-op。
  await admin
    .from("passkey_registration_grants")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString());

  // Phase 11c: 登録時の端末を auto-trust (= この端末からは即ログイン可)
  //   body.device_id (client cookie kt_device_id) を読み、trusted_devices に upsert。
  //   未指定なら trust 行は作らない (= 別 device で初回認証時に pending 行が作られる)。
  // Phase 11c-2 → 緩和: 「1 端末固定」を廃止。複数端末同時 approved を許可するが、
  //   上限を 2 台までに制限 (社用 + 私用 スマホ想定)。既に 2 台 approved の状態なら
  //   新端末は pending で投入し admin の承認を待たせる (= graceful degradation)。
  const APPROVED_DEVICE_LIMIT = 2;
  const bodyDeviceId = typeof body?.device_id === "string" ? body.device_id : null;
  const bodyDeviceLabel = typeof body?.device_label === "string" ? body.device_label : null;
  if (bodyDeviceId) {
    const ua = req.headers.get("user-agent") ?? null;
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;
    const nowIso = new Date().toISOString();
    // 当 device 以外の approved 端末数をカウント (再登録 = 既 approved 端末は除外しないと
    // 自分が 1 台目でも上限扱いになる)
    const { count: othersApprovedCount } = await admin
      .from("trusted_devices")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "approved")
      .neq("device_id", bodyDeviceId);
    const overLimit = (othersApprovedCount ?? 0) >= APPROVED_DEVICE_LIMIT;
    const targetStatus = overLimit ? "pending" : "approved";
    await admin.from("trusted_devices").upsert(
      {
        user_id: user.id,
        device_id: bodyDeviceId,
        device_label: bodyDeviceLabel,
        status: targetStatus,
        approved_at: overLimit ? null : nowIso,
        approved_by: overLimit ? null : user.id, // self-approve at registration
        last_seen_at: nowIso,
        first_seen_ua: ua,
        first_seen_ip: ip,
        revoked_at: null,
      },
      { onConflict: "user_id,device_id" }
    );
  }

  return NextResponse.json({ verified: true });
}

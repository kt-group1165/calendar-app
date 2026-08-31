import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase-server";

// POST /api/send-order-email
//
// 福祉用具の発注依頼メールを送る。
//
// 2026-08-31 監査での是正:
//   以前は route 内の認証が一切無く、`from` / `to` をリクエストボディから
//   そのまま Resend に渡していた。= 誰でも KT Group の検証済ドメインを
//   詐称して任意の宛先へ送れるオープンリレーだった。
//   現在は
//     ① ログイン必須
//     ② 宛先 (to) と 差出人 (from) は DB の settings から**サーバ側で**引く
//        (ボディの to/from は無視する)
//     ③ tenant は auth_visible_tenant_ids() で検証したものだけ使う
//   の 3 点で塞いでいる。本文 (利用者名・備考等) だけがボディ由来。

type Body = {
  tenantId?: unknown;
  clientName?: unknown;
  careOrg?: unknown;
  careManager?: unknown;
  notes?: unknown;
  senderName?: unknown;
};

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  // ① 認証
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  // ③ tenant は呼出ユーザに見えるものだけ
  const { data: tenantRows, error: tenantErr } = await supabase.rpc("auth_visible_tenant_ids");
  if (tenantErr) {
    return NextResponse.json({ error: "tenant_lookup_failed" }, { status: 500 });
  }
  type TenantRow = { auth_visible_tenant_ids?: string } | string;
  const visibleTenants = ((tenantRows ?? []) as TenantRow[])
    .map((r) => (typeof r === "string" ? r : r.auth_visible_tenant_ids ?? ""))
    .filter((t) => t.length > 0);
  if (visibleTenants.length === 0) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }
  const requested = asText(body.tenantId);
  const tenantId = requested && visibleTenants.includes(requested) ? requested : visibleTenants[0];

  // ② 宛先・差出人は DB から。ボディの to/from は使わない
  const { data: settingRows, error: settingErr } = await supabase
    .from("settings")
    .select("key, value")
    .eq("tenant_id", tenantId)
    .in("key", ["order_email_enabled", "order_email_to", "order_email_from"]);
  if (settingErr) {
    return NextResponse.json({ error: "settings_lookup_failed" }, { status: 500 });
  }
  const settings = new Map(
    ((settingRows ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? ""]),
  );
  if (settings.get("order_email_enabled") !== "true") {
    return NextResponse.json({ error: "order_email_disabled" }, { status: 400 });
  }
  const to = settings.get("order_email_to") ?? "";
  const from = settings.get("order_email_from") ?? "";
  if (!to || !from) {
    return NextResponse.json({ error: "送信先が設定されていません" }, { status: 400 });
  }

  const clientName = asText(body.clientName);
  const careOrg = asText(body.careOrg);
  const careManager = asText(body.careManager);
  const notes = asText(body.notes);
  const senderName = asText(body.senderName);

  const resend = new Resend(apiKey);

  const subject = `福祉用具発注のご依頼${clientName ? ` / ${clientName} 様` : ""}`;

  const bodyLines = [
    "お疲れ様です。",
    "下記の通り、福祉用具の発注をお願いいたします。",
    "",
    "───────────────────",
    `利用者名：${clientName || "（未設定）"}`,
    `支援事業所：${careOrg || "（未設定）"}`,
    `担当ケアマネ：${careManager || "（未設定）"}`,
    "───────────────────",
    ...(notes ? ["", "【備考】", notes] : []),
    "",
    "ご確認のほど、よろしくお願いいたします。",
    ...(senderName ? ["", senderName] : []),
  ];

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      text: bodyLines.join("\n"),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "送信エラー";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

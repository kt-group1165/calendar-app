import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  const { to, from, clientName, careOrg, careManager, notes, senderName } = await req.json();

  if (!to || !from) {
    return NextResponse.json({ error: "送信先が設定されていません" }, { status: 400 });
  }

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

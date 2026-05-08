// Passkey / WebAuthn helpers (server-side only).
// 設計:
//   - rpID は request host から動的に導出 (production / preview で別 origin に対応)
//   - challenge は passkey_challenges 表に短期保存 (5 分 expiry)
//   - public_key は base64 文字列で保存

import { headers } from "next/headers";

const RP_NAME = "ケイ・ティ・グループ カレンダー";

export async function getRpInfo(): Promise<{ rpID: string; origin: string; rpName: string }> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const isLocal = host.includes("localhost") || host.startsWith("127.");
  const protocol = isLocal ? "http" : "https";
  const origin = `${protocol}://${host}`;
  const rpID = host.split(":")[0]; // strip port
  return { rpID, origin, rpName: RP_NAME };
}

// base64 ⇔ base64url の変換 (DB は base64、WebAuthn は base64url)
export function base64ToUint8Array(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf);
}

export function uint8ArrayToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64");
}

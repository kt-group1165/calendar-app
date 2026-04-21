import { NextResponse } from "next/server";

// テナント別の PWA マニフェストを返す。
// Android Chrome で「ホーム画面に追加」する際、start_url がこのテナントの URL になる。
// （public/manifest.json は start_url: "/" 固定なので、/care-chiba などで追加しても起動時に "/" に戻ってしまう問題への対応）
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant } = await params;
  const safeTenant = encodeURIComponent(tenant);
  const body = {
    name: `カレンダー (${tenant})`,
    short_name: "カレンダー",
    description: "シンプルで見やすいカレンダーアプリ",
    start_url: `/${safeTenant}`,
    scope: `/${safeTenant}`,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6366f1",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  return NextResponse.json(body, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}

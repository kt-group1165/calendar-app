import type { Metadata } from "next";

// テナント配下では、start_url をこのテナントに固定した動的 manifest を参照させる。
// こうすることで、Android Chrome で /care-chiba を開いた状態で
// 「ホーム画面に追加」→ ホームから起動、という流れでも /care-chiba が開く。
export async function generateMetadata(
  { params }: { params: Promise<{ tenant: string }> },
): Promise<Metadata> {
  const { tenant } = await params;
  const safeTenant = encodeURIComponent(tenant);
  return {
    manifest: `/${safeTenant}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "カレンダー",
      startupImage: [],
    },
    other: {
      // iOS Safari 向け: ホーム追加時点の URL が使われるが、念のため明示。
      "apple-mobile-web-app-capable": "yes",
    },
  };
}

export default function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

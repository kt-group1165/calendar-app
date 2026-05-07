import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Phase 2-7 以降:
//   - PIN モード（匿名利用）廃止
//   - 公開ルート: /, /login, /invite/[token], /api/invite/[token], /auth/callback
//   - 認証必須ルート: /[tenant]/**, /admin/**, /api/admin/**, /api/backup
//
//   未認証で認証必須ルートへ来たユーザは /login?next=<元 URL> へ redirect。
//   認証済みユーザの場合は何もしない（各ページで個別の権限チェック）。
//
//   毎リクエストで getUser() を呼ぶことでセッション Cookie が自動延長される
//   副作用も維持。
//
// Soft-launch (ソフトローンチ) 用フラグ:
//   SOFT_LAUNCH_PUBLIC_TENANTS = true の間は /[tenant]/** をログインなしでアクセス
//   できるようにする。admin / api/admin / api/backup は引き続き保護。
//   実運用に切替えるときは false に戻すだけで完全な auth gate に復帰。
const SOFT_LAUNCH_PUBLIC_TENANTS = true;

const PUBLIC_PATHS = new Set<string>(["/", "/login"]);
const PUBLIC_PREFIXES = [
  "/invite/",        // /invite/[token]（招待 consume 画面、未ログインでアクセス）
  "/api/invite/",    // /api/invite/[token]（GET メタ + POST consume、anon）
  "/auth/",          // /auth/callback（magic link 等）
];

const ADMIN_PREFIXES = ["/admin", "/api/admin", "/api/backup"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

function isAdminRoute(pathname: string): boolean {
  for (const p of ADMIN_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

// Phase A2 (2026-05-07) — care-chiba tenant を kt-group に統合済み。
//   旧 URL `/care-chiba/...` をブックマークしているユーザ向けに `/kt-group`
//   へ rewrite。?office= は付けない（[tenant]/page.tsx 側の primaryOfficeId
//   auto-redirect が走るため）。
// Phase 8 (2026-05-08) — office-centric 統合に伴い、4 office-tenants を kt-group に
// 統合済。旧 URL は kt-group へ redirect (?office= 自動選択は primaryOfficeId に委譲)。
const LEGACY_TENANT_REDIRECTS: Record<string, string> = {
  "care-chiba": "kt-group",
  "hana-mutsumi": "kt-group",
  "hana-hanamigawa": "kt-group",
  "mutsumi-takashina": "kt-group",
  "links": "kt-group",
};

export async function proxy(request: NextRequest) {
  // 旧 tenant 互換 redirect: `/care-chiba` または `/care-chiba/foo` を `/kt-group...`
  // に振替。query string も維持。
  const pathname = request.nextUrl.pathname;
  for (const [oldId, newId] of Object.entries(LEGACY_TENANT_REDIRECTS)) {
    if (pathname === `/${oldId}` || pathname.startsWith(`/${oldId}/`)) {
      const target = request.nextUrl.clone();
      target.pathname = pathname.replace(`/${oldId}`, `/${newId}`);
      return NextResponse.redirect(target);
    }
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // 認証必須ルートで未ログインなら /login へ
  if (!user && !isPublicPath(pathname)) {
    // Soft-launch: tenant routes (/[tenant]/**) は一時的に公開。
    // admin 系 (/admin/**, /api/admin/**, /api/backup) は引き続き保護。
    if (SOFT_LAUNCH_PUBLIC_TENANTS && !isAdminRoute(pathname)) {
      return response;
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // static / image / favicon 以外のすべてのルート
    "/((?!_next/static|_next/image|favicon.ico|icon-192.png|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

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

const PUBLIC_PATHS = new Set<string>(["/", "/login"]);
const PUBLIC_PREFIXES = [
  "/invite/",        // /invite/[token]（招待 consume 画面、未ログインでアクセス）
  "/api/invite/",    // /api/invite/[token]（GET メタ + POST consume、anon）
  "/auth/",          // /auth/callback（magic link 等）
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

export async function proxy(request: NextRequest) {
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
  const pathname = request.nextUrl.pathname;
  if (!user && !isPublicPath(pathname)) {
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

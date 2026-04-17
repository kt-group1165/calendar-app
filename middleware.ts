import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Supabase Auth のセッション Cookie を毎リクエストで更新（延長）する。
// ルート保護はここでは行わない（PINモード互換のため）。
export async function middleware(request: NextRequest) {
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

  // getUser() を呼ぶことでセッションが有効なら Cookie が自動延長される。
  // 戻り値は使わない（各ページ側で個別に呼び出す）。
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // static / image / favicon 以外のすべてのルート
    "/((?!_next/static|_next/image|favicon.ico|icon-192.png|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

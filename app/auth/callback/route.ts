import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Magic Link / Email 確認のコールバック。
// Supabase からの ?code=... を受け取り、セッション Cookie を確立してから / へリダイレクト。
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=auth_callback_failed", url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

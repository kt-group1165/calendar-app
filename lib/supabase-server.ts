import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Component / Route Handler / Server Action 用の Supabase クライアント。
// Next.js の cookies() API とブリッジすることで、ブラウザのセッション Cookie を使って
// 認証済みコンテキストでクエリを発行できる。
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component から呼び出された場合は set に失敗することがある。
            // middleware.ts でのセッション更新が成功していればここは無視してよい。
          }
        },
      },
    }
  );
}

// service_role を使う admin クライアント（招待・権限変更など）。
// 呼び出し側でこのクライアントを使う場合は、事前に呼び出しユーザーの認証と権限を
// 必ず別経路で検証すること（RLS をバイパスするため）。
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      cookies: {
        getAll() { return []; },
        setAll() {},
      },
    }
  );
}

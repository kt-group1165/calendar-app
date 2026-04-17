import { createBrowserClient } from "@supabase/ssr";

// ブラウザ側（Client Component）用の Supabase クライアント。
// Cookie ベースでセッションを共有するので、middleware.ts / Server Component と一貫した auth 状態になる。
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// 従来の `supabase` シングルトン互換（アプリ全体で使い回される）。
// モジュール初回ロード時に生成されるため、SSR 時は使わないこと。
let _client: ReturnType<typeof createBrowserClient> | null = null;
export function getSupabase() {
  if (typeof window === "undefined") {
    // サーバー側では毎回新しいクライアントを返すのが安全（セッションが混ざらない）
    return createClient();
  }
  if (!_client) _client = createClient();
  return _client;
}

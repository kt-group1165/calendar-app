"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Loader2, LogOut, User as UserIcon } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { getTenants, type Tenant } from "@/lib/tenants";
import { getSupabase } from "@/lib/supabase-browser";
import { signOut } from "@/lib/auth";

// ホーム画面（テナント一覧）。
// Phase 2-7 以降:
//   - PIN モードは廃止、未認証ユーザは middleware が /login へ追放するため
//     ここに到達した時点で必ず authUser がいる。
//   - tenant 一覧は新 RLS 経由で「自分が見える tenant」のみが返る。

export default function HomePage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();

      const { data: { user } } = await supabase.auth.getUser();
      setAuthUser(user);
      if (!user) {
        router.replace("/login?next=/");
        return;
      }

      try {
        const list = await getTenants();
        setTenants(list.filter((t) => t.id !== "default"));
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function handleLogout() {
    if (!confirm("ログアウトしますか？")) return;
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl shadow-lg mb-2">
            <CalendarDays size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">カレンダー</h1>
          <p className="text-sm text-gray-400">チームを選択してください</p>
        </div>

        {authUser && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
              <UserIcon size={14} className="text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400">ログイン中</p>
              <p className="text-sm font-medium text-gray-800 truncate">{authUser.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-400 shrink-0"
              title="ログアウト"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-indigo-400" />
            </div>
          ) : tenants.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">
              所属するチームがありません。管理者に招待を依頼してください。
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {tenants.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => router.push(`/${t.id}`)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-indigo-50 transition-colors active:bg-indigo-100"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                        <CalendarDays size={18} className="text-indigo-500" />
                      </div>
                      <span className="text-sm font-semibold text-gray-800">{t.name}</span>
                    </div>
                    <ChevronRight size={16} className="text-gray-300" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

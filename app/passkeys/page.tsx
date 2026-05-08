"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Fingerprint, Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase-browser";
import PasskeyManager from "@/components/PasskeyManager";

// /passkeys
//
// ログイン中ユーザーが自分のパスキーを管理する page。
// home page (/) や change-password から遷移してくる。

export default function PasskeysPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then((res: { data: { user: User | null } }) => {
      if (!res.data.user) {
        router.replace("/login?next=/passkeys");
        return;
      }
      setUser(res.data.user);
      setAuthChecked(true);
    });
  }, [router]);

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-white">
        <Loader2 size={28} className="animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white p-6">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-500"
        >
          <ArrowLeft size={14} />
          戻る
        </button>

        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-500 rounded-2xl shadow-lg mb-1">
            <Fingerprint size={26} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">パスキー管理</h1>
          {user?.email && (
            <p className="text-[11px] text-gray-400 truncate">{user.email}</p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <PasskeyManager />
        </div>

        <p className="text-[10px] text-gray-400 text-center leading-relaxed pt-2">
          端末を紛失・買い替えした場合は、該当パスキーを削除してください。<br />
          パスワードは別途有効なので、ログインできなくなることはありません。
        </p>
      </div>
    </div>
  );
}

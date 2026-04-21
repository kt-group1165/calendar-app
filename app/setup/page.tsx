"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ShieldCheck, Loader2, ArrowRight, Mail, Lock } from "lucide-react";
import { getSupabase } from "@/lib/supabase-browser";
import { getTenants } from "@/lib/tenants";

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // テナントが 1 件でも存在すれば既に運用中 → ログイン画面へ
        // （user_tenants は RLS の関係で匿名では count=0 になるので使わない）
        const list = await getTenants();
        const nonDefault = list.filter((t) => t.id !== "default");
        if (nonDefault.length > 0) {
          router.replace("/login");
          return;
        }
      } catch {
        // エラー時はセットアップ画面を表示し続ける
      }
      setChecking(false);
    })();
  }, [router]);

  async function handleSignup() {
    if (!email.trim() || !password || !displayName.trim()) {
      setMessage({ type: "error", text: "すべての項目を入力してください" });
      return;
    }
    if (password !== confirmPassword) {
      setMessage({ type: "error", text: "パスワードが一致しません" });
      return;
    }
    if (password.length < 8) {
      setMessage({ type: "error", text: "パスワードは8文字以上にしてください" });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const supabase = getSupabase();
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
          data: { display_name: displayName.trim() },
        },
      });
      if (signUpError) {
        setMessage({ type: "error", text: signUpError.message });
        return;
      }
      const userId = signUpData.user?.id;
      if (!userId) {
        setMessage({ type: "error", text: "アカウント作成に失敗しました" });
        return;
      }

      // まだユーザーが誰もいない → この人が最初の master
      // 全テナントに master として所属させる
      const { data: tenants } = await supabase.from("tenants").select("id");
      const tenantList = (tenants ?? []) as { id: string }[];
      if (tenantList.length > 0) {
        const rows = tenantList.map((t) => ({
          user_id: userId,
          tenant_id: t.id,
          role: "master" as const,
        }));
        await supabase.from("user_tenants").insert(rows);
      }

      // メール確認が有効なプロジェクトでは session が null になる。
      if (!signUpData.session) {
        setMessage({
          type: "success",
          text: "📧 確認メールを送信しました。リンクをタップして登録を完了してください。",
        });
      } else {
        setMessage({ type: "success", text: "✅ 管理者アカウントを作成しました" });
        setTimeout(() => router.push("/"), 1200);
      }
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        {/* ロゴ */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl shadow-lg mb-2">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">初期セットアップ</h1>
          <p className="text-sm text-gray-400">最初の管理者アカウントを作成します</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
          ⚠️ この画面はまだ誰もユーザーが登録されていないときだけ表示されます。
          作成するアカウントは <strong>全テナントの管理者（master）</strong> になります。
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
              <CalendarDays size={12} />表示名（あなたの名前）
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="山田 太郎"
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
              <Mail size={12} />メールアドレス
            </label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
              <Lock size={12} />パスワード（8文字以上）
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">パスワード（確認）</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSignup()}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
          </div>

          {message && (
            <div className={`text-xs p-2.5 rounded-xl ${
              message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
            }`}>
              {message.text}
            </div>
          )}

          <button
            onClick={handleSignup}
            disabled={loading}
            className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            管理者アカウントを作成
            {!loading && <ArrowRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

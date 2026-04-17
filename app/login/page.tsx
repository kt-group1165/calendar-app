"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Mail, Lock, Loader2, ArrowRight } from "lucide-react";
import { getSupabase } from "@/lib/supabase-browser";

type Mode = "magic" | "password";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleMagicLink() {
    if (!email.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const supabase = getSupabase();
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (error) {
        setMessage({ type: "error", text: error.message });
      } else {
        setMessage({ type: "success", text: "📧 ログインリンクをメールで送信しました。リンクをタップしてください。" });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setMessage(null);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setMessage({ type: "error", text: "メールまたはパスワードが正しくありません" });
      } else {
        router.push("/");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        {/* ロゴ */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl shadow-lg mb-2">
            <CalendarDays size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">ログイン</h1>
          <p className="text-sm text-gray-400">カレンダーアプリにサインイン</p>
        </div>

        {/* モード切替タブ */}
        <div className="bg-gray-100 rounded-xl p-1 flex gap-1">
          <button
            onClick={() => { setMode("magic"); setMessage(null); }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              mode === "magic" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500"
            }`}
          >
            <Mail size={14} className="inline mr-1" />リンクで
          </button>
          <button
            onClick={() => { setMode("password"); setMessage(null); }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              mode === "password" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500"
            }`}
          >
            <Lock size={14} className="inline mr-1" />パスワード
          </button>
        </div>

        {/* フォーム */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">メールアドレス</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
          </div>

          {mode === "password" && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">パスワード</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePassword()}
                className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
              />
            </div>
          )}

          {message && (
            <div className={`text-xs p-2.5 rounded-xl ${
              message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
            }`}>
              {message.text}
            </div>
          )}

          <button
            onClick={mode === "magic" ? handleMagicLink : handlePassword}
            disabled={loading || !email.trim() || (mode === "password" && !password)}
            className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {mode === "magic" ? "ログインリンクを送信" : "ログイン"}
            {!loading && <ArrowRight size={16} />}
          </button>

          <p className="text-xs text-gray-400 text-center">
            {mode === "magic"
              ? "メールに送られるリンクをタップしてログインします（パスワード不要）"
              : "パスワードを忘れた場合は管理者に連絡してください"}
          </p>
        </div>

        {/* PIN モードで続ける（移行期間中のフォールバック） */}
        <div className="text-center">
          <button
            onClick={() => router.push("/")}
            className="text-xs text-gray-400 hover:text-indigo-500 underline underline-offset-2"
          >
            ログインせずに続ける（従来のPIN方式）
          </button>
        </div>
      </div>
    </div>
  );
}

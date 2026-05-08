"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Loader2, Lock } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase-browser";

// /change-password
//
// 初回ログイン直後 or admin によるパスワードリセット直後に強制表示される画面。
// auth.users.user_metadata.password_change_required = true なら proxy がここに
// redirect する。本人が新パスワードを設定すると flag を false にして通常画面へ。

export default function ChangePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then((res: { data: { user: User | null } }) => {
      if (!res.data.user) {
        router.replace("/login?next=/change-password");
        return;
      }
      setAuthChecked(true);
    });
  }, [router]);

  async function handleSubmit() {
    setMessage(null);
    if (password.length < 8) {
      setMessage({ type: "error", text: "パスワードは 8 文字以上で設定してください。" });
      return;
    }
    if (password !== confirm) {
      setMessage({ type: "error", text: "確認用パスワードが一致しません。" });
      return;
    }
    setSubmitting(true);
    const supabase = getSupabase();
    // パスワード更新 + flag クリア
    // 既存 user_metadata は updateUser({ data }) で merge される (Supabase 仕様)
    const { error } = await supabase.auth.updateUser({
      password,
      data: { password_change_required: false },
    });
    if (error) {
      setMessage({ type: "error", text: `更新失敗: ${error.message}` });
      setSubmitting(false);
      return;
    }
    setMessage({ type: "success", text: "パスワードを変更しました。" });
    // 短い遅延の後、ホームへ
    setTimeout(() => {
      router.replace("/");
    }, 800);
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-white">
        <Loader2 size={28} className="animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl shadow-lg mb-2">
            <Lock size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">パスワードの変更</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            初期パスワードのままでは利用できません。<br />
            ご自身で覚えやすいパスワードに変更してください。
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">新しいパスワード（8 文字以上）</label>
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <Lock size={14} className="text-gray-400 shrink-0" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8 文字以上"
                className="flex-1 bg-transparent text-sm focus:outline-none"
                minLength={8}
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">確認のためもう一度</label>
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <Lock size={14} className="text-gray-400 shrink-0" />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="同じものを入力"
                className="flex-1 bg-transparent text-sm focus:outline-none"
                minLength={8}
              />
            </div>
          </div>

          {message && (
            <div
              className={`text-xs rounded-xl p-2.5 ${
                message.type === "error"
                  ? "bg-red-50 text-red-600 border border-red-100"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-100"
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || password.length < 8 || password !== confirm}
            className="w-full flex items-center justify-center gap-1 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            変更して続行
          </button>
        </div>

        <div className="text-center">
          <CalendarDays size={16} className="text-gray-300 inline-block" />
          <p className="text-[10px] text-gray-400 mt-1">
            このページから離れないでください。変更が完了するまで他の画面は利用できません。
          </p>
        </div>
      </div>
    </div>
  );
}

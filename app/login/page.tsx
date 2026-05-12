"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CalendarDays, CheckCircle2, Fingerprint, Loader2, Lock, User } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { getSupabase } from "@/lib/supabase-browser";
import { isValidLoginId } from "@/lib/login_id";
import { ensureDeviceId, detectDeviceLabel } from "@/lib/device_id";

// /login
//
// Phase 2-7 以降:
//   - 単一の「ログイン ID または メールアドレス」入力欄
//     - 文字列に @ があれば実 email として扱う（group_admin / 旧アカウント互換）
//     - なければ login_id として扱い、`<id>@kt-staff.invalid` に派生
//   - パスワード認証のみ（magic link は廃止）
//   - PIN モードへのフォールバックは §14 で別途削除予定（移行期は残す）

export default function LoginPage() {
  // Next.js 16 の static generation で useSearchParams を使うには Suspense
  // 境界が必要。ページ本体を子コンポーネントに分離する。
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-indigo-400" />
    </div>
  );
}

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const nextPath = search.get("next") ?? "/";
  const presetLoginId = search.get("login_id") ?? "";
  const inviteJustDone = search.get("hint") === "invite_done";

  const [identifier, setIdentifier] = useState(presetLoginId);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(
    inviteJustDone
      ? { type: "info", text: "アカウントを作成しました。設定したパスワードでログインしてください。" }
      : null
  );

  // 既ログインなら飛ばす
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then((res: { data: { user: unknown } }) => {
      if (res.data.user) router.replace(nextPath);
    });
  }, [router, nextPath]);

  async function handleSubmit() {
    if (!identifier.trim() || !password) return;

    setLoading(true);
    setMessage(null);
    try {
      // Phase 11: /api/login 経由 (passkey 排他 + emergency consume を server で enforce)
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      if (res.ok) {
        // server 側で session cookie が set 済 → 遷移後に SSR で認識
        router.replace(nextPath);
        return;
      }
      // エラー振り分け (status / error code)
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.status === 403 && data.error === "passkey_required") {
        setMessage({
          type: "error",
          text:
            data.message ??
            "この account には Passkey が登録されています。下の「パスキーでログイン」を使ってください。",
        });
      } else {
        setMessage({ type: "error", text: "ログイン ID（またはメール）かパスワードが正しくありません" });
      }
    } catch {
      setMessage({ type: "error", text: "ログインに失敗しました" });
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    setLoading(true);
    setMessage(null);
    try {
      // identifier は任意 (resident key 対応端末は無くても OK だが、一覧抽出のため渡す)
      const beginRes = await fetch("/api/passkey/auth/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() || undefined }),
      });
      if (!beginRes.ok) throw new Error("auth/begin failed");
      const { options } = await beginRes.json();

      // ブラウザ側 (FaceID / 指紋 / PIN / パターン)
      const assertion = await startAuthentication({ optionsJSON: options });

      // Phase 11c: 端末識別子を一緒に送る (trust check 用)
      const deviceId = ensureDeviceId();
      const deviceLabel = detectDeviceLabel();
      const completeRes = await fetch("/api/passkey/auth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion, device_id: deviceId, device_label: deviceLabel }),
      });
      const completeJson = (await completeRes.json().catch(() => ({}))) as {
        verified?: boolean;
        status?: "approval_required" | "device_revoked";
        message?: string;
        token_hash?: string;
        error?: string;
      };

      // 202 (承認待ち) / 403 (revoked) → token 発行されない
      if (completeJson.status === "approval_required") {
        setMessage({
          type: "info",
          text:
            completeJson.message ??
            "新しい端末からのログインです。管理者の承認をお待ちください。",
        });
        return;
      }
      if (completeJson.status === "device_revoked") {
        setMessage({
          type: "error",
          text:
            completeJson.message ??
            "この端末は無効化されています。管理者に連絡してください。",
        });
        return;
      }
      if (!completeRes.ok || !completeJson.token_hash) {
        throw new Error(completeJson.error ?? "auth/complete failed");
      }

      const supabase = getSupabase();
      const { error: otpErr } = await supabase.auth.verifyOtp({
        token_hash: completeJson.token_hash,
        type: "magiclink",
      });
      if (otpErr) throw new Error(otpErr.message);

      router.replace(nextPath);
    } catch (e) {
      const msg = (e as Error).message ?? "認証に失敗しました";
      // ユーザーキャンセル系は静かに戻す
      if (/cancel|abort|NotAllowed/i.test(msg)) {
        setMessage(null);
      } else {
        setMessage({ type: "error", text: `パスキーで login できませんでした: ${msg}` });
      }
    } finally {
      setLoading(false);
    }
  }

  const identifierLooksValid =
    identifier.trim().length > 0 &&
    (identifier.includes("@") || isValidLoginId(identifier.trim()));

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl shadow-lg mb-2">
            <CalendarDays size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">ログイン</h1>
          <p className="text-sm text-gray-400">カレンダーアプリにサインイン</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              <User size={11} className="inline mr-1" />
              ログイン ID または メールアドレス
            </label>
            <input
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="hanako.s または name@example.com"
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              <Lock size={11} className="inline mr-1" />
              パスワード
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
          </div>

          {message && (
            <div
              className={`text-xs p-2.5 rounded-xl flex items-start gap-2 ${
                message.type === "success" || message.type === "info"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {message.type !== "error" && <CheckCircle2 size={12} className="shrink-0 mt-0.5" />}
              <span>{message.text}</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !identifierLooksValid || !password}
            className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            ログイン
            {!loading && <ArrowRight size={16} />}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-[10px] text-gray-300 uppercase tracking-wider">または</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          <button
            onClick={handlePasskeyLogin}
            disabled={loading}
            className="w-full py-3 bg-white border-2 border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50 text-indigo-600 font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
            パスキーでログイン
          </button>
          <p className="text-[10px] text-gray-400 text-center leading-relaxed">
            FaceID / 指紋 / パターン / PIN で認証<br />
            <span className="text-gray-300">登録済の端末でのみ利用できます</span>
          </p>

          <p className="text-xs text-gray-400 text-center leading-relaxed pt-2 border-t border-gray-50">
            パスワードを忘れた場合は管理者に連絡してください<br />
            <span className="text-gray-300">（招待を再発行してもらう運用）</span>
          </p>
        </div>
      </div>
    </div>
  );
}

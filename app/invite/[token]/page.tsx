"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  UserCheck,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase-browser";
import { isValidLoginId } from "@/lib/login_id";

// /invite/[token]
//
// 招待を受けたスタッフがアクセスする画面。
//
// フロー:
//   1. mount → GET /api/invite/[token] で metadata 取得（display_name / role / office_name）
//      失敗 → 「無効な招待」表示
//   2. invitee が initial_password + 自分の login_id + new_password を入力
//   3. POST /api/invite/[token] → サーバが auth.user 作成 + user_offices INSERT
//   4. 成功時、返ってきた synthetic email + new_password で signInWithPassword
//   5. 自動でホームへ遷移

type InviteMeta = {
  display_name: string;
  role: "office_admin" | "member";
  office_name: string | null;
  tenant_name: string | null;
  expires_at: string;
  login_id: string | null;  // null の場合は invitee が consume 時に決める (旧挙動)
};

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [meta, setMeta] = useState<InviteMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [initialPassword, setInitialPassword] = useState("");
  const [loginIdInput, setLoginIdInput] = useState("");  // invitation の login_id が無い場合の fallback 入力
  const [newPassword, setNewPassword] = useState("");
  const [showInit, setShowInit] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // invitation 側で確定済の login_id があればそちらを優先、無ければ invitee 入力。
  const effectiveLoginId = meta?.login_id ?? loginIdInput;

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invite/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          setMetaError("この招待は無効か、期限切れです。発行者に再発行を依頼してください。");
          return;
        }
        setMeta(await r.json());
      })
      .catch(() => setMetaError("通信エラーが発生しました"))
      .finally(() => setLoadingMeta(false));
  }, [token]);

  const loginIdOk = isValidLoginId(effectiveLoginId);
  const newPwOk = newPassword.length >= 8;
  const formOk = initialPassword.length > 0 && loginIdOk && newPwOk;

  async function submit() {
    if (!formOk || !meta) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          initial_password: initialPassword,
          login_id: effectiveLoginId,
          new_password: newPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          not_found: "この招待は無効か、期限切れです。",
          initial_password_mismatch: "初期パスワードが正しくありません。",
          login_id_invalid: "ログイン ID は英小文字で始まり、4〜24 文字（英小・数字・ピリオド・ハイフン可）にしてください。",
          login_id_taken: "そのログイン ID は既に使われています。別の ID を試してください。",
          new_password_invalid: "新しいパスワードは 8 文字以上で設定してください。",
        };
        setErrorMsg(messages[json.error] ?? `エラー: ${json.error ?? res.statusText}`);
        return;
      }

      // signInWithPassword でセッション確立 → ホームへ
      const supabase = getSupabase();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: json.email,
        password: newPassword,
      });
      if (signInError) {
        // アカウントは作成済だがセッション作成失敗。/login へ誘導。
        router.replace(`/login?login_id=${encodeURIComponent(effectiveLoginId)}&hint=invite_done`);
        return;
      }
      router.replace("/");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 状態別レンダリング ────────────────────────────────────────────
  if (loadingMeta) {
    return (
      <Centered>
        <Loader2 size={28} className="animate-spin text-indigo-400" />
      </Centered>
    );
  }

  if (metaError || !meta) {
    return (
      <Centered>
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-red-100 p-6 text-center space-y-2">
          <AlertCircle size={28} className="mx-auto text-red-400" />
          <h1 className="text-base font-bold text-gray-800">招待が無効です</h1>
          <p className="text-xs text-gray-500 leading-relaxed">{metaError}</p>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="max-w-sm w-full space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-1 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-100 rounded-2xl mb-2">
            <UserCheck size={20} className="text-indigo-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-800">ようこそ</h1>
          <p className="text-sm text-gray-500">
            <strong>{meta.display_name}</strong> さん
          </p>
          <p className="text-xs text-gray-400">
            {meta.tenant_name ? `${meta.tenant_name} / ` : ""}{meta.office_name ?? ""}
            {" · "}
            {meta.role === "office_admin" ? "事業所管理者" : "メンバー"} として招待されています
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <PasswordField
            label="初期パスワード（管理者から受け取ったもの）"
            value={initialPassword}
            onChange={setInitialPassword}
            visible={showInit}
            onToggle={() => setShowInit((v) => !v)}
            placeholder="abcDEF234..."
            autoComplete="one-time-code"
          />

          {meta.login_id ? (
            // admin が招待発行時に login_id を確定済 → readonly 表示
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">
                ログイン ID（管理者が指定）
              </label>
              <div className="w-full text-sm border-2 border-gray-100 bg-gray-50 rounded-xl px-3 py-2 font-mono text-gray-700 select-all">
                {meta.login_id}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                ※ 次回以降このログイン ID と、下で設定するパスワードでログインします
              </p>
            </div>
          ) : (
            // 旧挙動: invitation 側に login_id が無い場合は invitee が決める
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">
                ログイン ID（自分で決める）
              </label>
              <input
                type="text"
                value={loginIdInput}
                onChange={(e) => setLoginIdInput(e.target.value.toLowerCase())}
                placeholder="例: hanako.s"
                autoComplete="username"
                className={`w-full text-sm border-2 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 ${
                  loginIdInput.length > 0 && !loginIdOk ? "border-red-200 bg-red-50/30" : "border-gray-200"
                }`}
              />
              <p className="text-[10px] text-gray-400 mt-1">
                英小文字で始める · 英小・数字・ピリオド・ハイフン · 4〜24 文字
                <br />
                ※ 次回以降このログイン ID とパスワードでログインします
              </p>
            </div>
          )}

          <PasswordField
            label="新しいパスワード（8 文字以上）"
            value={newPassword}
            onChange={setNewPassword}
            visible={showNew}
            onToggle={() => setShowNew((v) => !v)}
            placeholder="8 文字以上"
            autoComplete="new-password"
            error={newPassword.length > 0 && !newPwOk}
          />

          {errorMsg && (
            <div className="text-xs bg-red-50 text-red-600 border border-red-100 rounded-xl p-2.5">
              {errorMsg}
            </div>
          )}

          <button
            onClick={submit}
            disabled={!formOk || submitting}
            className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <CheckCircle2 size={16} />
                アカウントを作成してログイン
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>

        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          <Lock size={11} className="inline mr-1" />
          初期パスワードは 1 回限り。設定したログイン ID と新しいパスワードは安全に保管してください。
        </p>
      </div>
    </Centered>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  placeholder,
  autoComplete,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder?: string;
  autoComplete?: string;
  error?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 mb-1 block">{label}</label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`w-full text-sm border-2 rounded-xl px-3 py-2 pr-10 focus:outline-none focus:border-indigo-400 ${
            error ? "border-red-200 bg-red-50/30" : "border-gray-200"
          }`}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600"
          tabIndex={-1}
          aria-label={visible ? "隠す" : "表示"}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex items-center justify-center p-4">
      {children}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { ArrowLeft, Fingerprint, Loader2, Trash2, Plus, ShieldCheck, AlertTriangle } from "lucide-react";
import { getSupabase } from "@/lib/supabase-browser";
import { ensureDeviceId, detectDeviceLabel } from "@/lib/device_id";

// /settings/passkey
//
// Phase 11: ユーザ自身が Passkey を登録・削除する画面。
//
// 動作:
//   - 自分の passkey_credentials 一覧表示
//   - 「Passkey を追加登録」ボタン → /api/passkey/register/{begin,complete}
//       ・1 台目: そのまま登録可
//       ・2 台目以降: admin の grant が有効な場合のみ登録可 (begin で 403)
//   - 各 row の「削除」ボタン → supabase 直 delete (RLS で self_delete 許可)
//
// 注意:
//   - 全 passkey を削除すると ID/PW ログインに戻る (Phase 11 方式 A)
//   - 削除確認 prompt あり

interface PasskeyCredential {
  id: string;
  credential_id: string;
  device_name: string | null;
  backup_state: boolean;
  created_at: string;
}

interface ActiveGrant {
  id: string;
  expires_at: string;
}

export default function PasskeySettingsPage() {
  const router = useRouter();
  const supabase = getSupabase();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([]);
  const [activeGrant, setActiveGrant] = useState<ActiveGrant | null>(null);
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        router.replace("/login?next=/settings/passkey");
        return;
      }
      setUser({ id: userData.user.id, email: userData.user.email ?? null });

      const [credRes, grantRes] = await Promise.all([
        supabase
          .from("passkey_credentials")
          .select("id, credential_id, device_name, backup_state, created_at")
          .eq("user_id", userData.user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("passkey_registration_grants")
          .select("id, expires_at")
          .eq("user_id", userData.user.id)
          .is("consumed_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("expires_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      setCredentials(((credRes.data ?? []) as PasskeyCredential[]));
      setActiveGrant((grantRes.data as ActiveGrant | null) ?? null);
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- HANDOVER §2 (mount-time async fetch / mount init)
    fetchAll();
  }, [fetchAll]);

  const handleRegister = async () => {
    setMessage(null);
    setRegistering(true);
    try {
      const beginRes = await fetch("/api/passkey/register/begin", { method: "POST" });
      if (!beginRes.ok) {
        const data = (await beginRes.json().catch(() => ({}))) as { error?: string; message?: string };
        if (beginRes.status === 403 && data.error === "additional_registration_not_permitted") {
          setMessage({
            type: "error",
            text: data.message ?? "既に Passkey が登録されています。追加登録には管理者の許可が必要です。",
          });
        } else {
          setMessage({ type: "error", text: "登録の準備に失敗しました" });
        }
        return;
      }
      const { options } = await beginRes.json();

      // ブラウザ WebAuthn API (FaceID / 指紋 / Windows Hello)
      const attestation = await startRegistration({ optionsJSON: options });

      // Phase 11c: 登録時の端末を auto-trust するため device_id も送る
      const deviceId = ensureDeviceId();
      const deviceLabel = detectDeviceLabel();
      const completeRes = await fetch("/api/passkey/register/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: attestation,
          deviceName: deviceLabel,
          device_id: deviceId,
          device_label: deviceLabel,
        }),
      });
      if (!completeRes.ok) {
        const data = (await completeRes.json().catch(() => ({}))) as { error?: string; message?: string };
        // サーバが日本語 message を返してきたら最優先で表示。なければ error code を補助表示。
        const text = data.message
          ? data.message
          : data.error
          ? `登録に失敗しました: ${data.error}`
          : "登録に失敗しました";
        setMessage({ type: "error", text });
        return;
      }
      setMessage({ type: "success", text: "Passkey を登録しました。次回からこの端末で指紋/顔認証でログインできます。" });
      await fetchAll();
    } catch (e) {
      const msg = (e as Error).message;
      if (/cancel|abort|NotAllowed/i.test(msg)) {
        setMessage(null);
      } else {
        setMessage({ type: "error", text: `登録に失敗しました: ${msg}` });
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (cred: PasskeyCredential) => {
    if (!user) return;
    const isLast = credentials.length === 1;
    const label = cred.device_name ?? cred.credential_id.slice(0, 8);
    const warn = isLast
      ? `「${label}」が最後の Passkey です。削除すると次回からは ID/パスワードでのログインに戻ります。本当に削除しますか?`
      : `「${label}」を削除します。よろしいですか?`;
    if (!confirm(warn)) return;

    setDeletingId(cred.id);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("passkey_credentials")
        .delete()
        .eq("id", cred.id);
      if (error) {
        setMessage({ type: "error", text: `削除に失敗しました: ${error.message}` });
        return;
      }
      setMessage({ type: "success", text: "Passkey を削除しました" });
      await fetchAll();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            aria-label="戻る"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-xl font-bold text-gray-800">Passkey 管理</h1>
        </div>

        {/* user 情報 */}
        <div className="rounded-lg bg-white border border-gray-200 p-4">
          <p className="text-xs text-gray-500">ログイン中のアカウント</p>
          <p className="text-sm font-medium text-gray-800 mt-0.5">{user?.email}</p>
        </div>

        {/* message */}
        {message && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              message.type === "success"
                ? "bg-green-50 border-green-200 text-green-700"
                : message.type === "error"
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-blue-50 border-blue-200 text-blue-700"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* 追加登録許可の表示 */}
        {activeGrant && credentials.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">追加登録が許可されています</p>
              <p className="text-xs mt-0.5">
                {new Date(activeGrant.expires_at).toLocaleString("ja-JP")} まで新端末で Passkey を登録できます。
              </p>
            </div>
          </div>
        )}

        {/* 登録済 passkey 一覧 */}
        <div className="rounded-lg bg-white border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">登録済 Passkey</h2>
            <button
              type="button"
              onClick={handleRegister}
              disabled={registering || (credentials.length > 0 && !activeGrant)}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={
                credentials.length > 0 && !activeGrant
                  ? "2 台目以降の登録には管理者の許可が必要です"
                  : "この端末で Passkey を登録"
              }
            >
              {registering ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              新規登録
            </button>
          </div>
          {credentials.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Fingerprint size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">まだ Passkey が登録されていません</p>
              <p className="text-xs text-gray-400 mt-1">
                上の「新規登録」ボタンでこの端末を登録できます
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {credentials.map((cred) => (
                <li key={cred.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="rounded-md bg-indigo-50 p-2">
                    <Fingerprint size={16} className="text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {cred.device_name ?? "端末名なし"}
                    </p>
                    <p className="text-xs text-gray-500">
                      登録: {new Date(cred.created_at).toLocaleString("ja-JP")}
                      {cred.backup_state ? " · クラウド同期" : " · 端末固定"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(cred)}
                    disabled={deletingId === cred.id}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                    title="この Passkey を削除"
                  >
                    {deletingId === cred.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* セキュリティ ポリシー説明 (trust model) */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">セキュリティ ポリシー (端末承認制)</p>
            <ul className="space-y-0.5 leading-relaxed list-disc list-inside">
              <li>Passkey の同期 (iCloud Keychain / Google) は許可</li>
              <li>ただし<strong>各端末ごとに管理者の承認</strong>が必要 (= 別 PC や QR 経由のログインは admin 承認後のみ)</li>
              <li>この端末で Passkey を登録するとこの端末は自動承認</li>
              <li>Passkey が登録されている間は ID/パスワードログイン不可</li>
              <li>機種変・紛失時は管理者に連絡 (Passkey or 端末承認を削除でリセット)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

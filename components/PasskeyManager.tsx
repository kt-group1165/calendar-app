"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Fingerprint, Loader2, Trash2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { getSupabase } from "@/lib/supabase-browser";

// 自分のパスキーの登録/削除を行う UI。
// /change-password と /passkeys の両方から共通利用するため独立 component に。

type PasskeyRow = {
  id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
};

export default function PasskeyManager({ compact = false }: { compact?: boolean }) {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceNameInput, setDeviceNameInput] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("passkey_credentials")
      .select("id, device_name, created_at, last_used_at")
      .order("created_at", { ascending: false });
    setPasskeys((data as PasskeyRow[]) ?? []);
    setLoaded(true);
  }

  async function register() {
    setMessage(null);
    setBusy(true);
    try {
      const beginRes = await fetch("/api/passkey/register/begin", { method: "POST" });
      if (!beginRes.ok) throw new Error("register/begin failed");
      const { options } = await beginRes.json();
      const attestation = await startRegistration({ optionsJSON: options });
      const completeRes = await fetch("/api/passkey/register/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: attestation,
          deviceName: deviceNameInput.trim() || undefined,
        }),
      });
      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}));
        throw new Error(err.error ?? "register/complete failed");
      }
      setMessage({ type: "success", text: "このデバイスをパスキーとして登録しました。" });
      setDeviceNameInput("");
      await load();
    } catch (e) {
      const msg = (e as Error).message ?? "登録に失敗しました";
      if (/cancel|abort|NotAllowed/i.test(msg)) {
        setMessage(null);
      } else {
        setMessage({ type: "error", text: `登録できませんでした: ${msg}` });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("このパスキーを削除しますか？")) return;
    const supabase = getSupabase();
    const { error } = await supabase.from("passkey_credentials").delete().eq("id", id);
    if (error) {
      setMessage({ type: "error", text: `削除失敗: ${error.message}` });
      return;
    }
    setMessage({ type: "success", text: "パスキーを削除しました。" });
    await load();
  }

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center gap-2">
          <Fingerprint size={18} className="text-indigo-500" />
          <h2 className="text-sm font-semibold text-gray-700">パスキー（FaceID / 指紋 / パターン / PIN）</h2>
        </div>
      )}
      {!compact && (
        <p className="text-xs text-gray-500 leading-relaxed">
          このデバイスをパスキー登録すると、次回から FaceID や指紋などでログインできます。
          パスワードと併用できます。
        </p>
      )}

      <div>
        <label className="text-xs font-semibold text-gray-500 mb-1 block">デバイス名（任意）</label>
        <input
          type="text"
          value={deviceNameInput}
          onChange={(e) => setDeviceNameInput(e.target.value)}
          placeholder="iPhone / 業務用 Pixel など"
          className="w-full text-sm bg-gray-50 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      <button
        onClick={register}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border-2 border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-40 text-indigo-600 text-sm font-semibold rounded-xl"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={14} />}
        このデバイスを登録
      </button>

      {message && (
        <div
          className={`text-xs rounded-xl p-2.5 flex items-start gap-2 ${
            message.type === "error"
              ? "bg-red-50 text-red-600 border border-red-100"
              : "bg-emerald-50 text-emerald-700 border border-emerald-100"
          }`}
        >
          {message.type === "success" && <CheckCircle2 size={12} className="shrink-0 mt-0.5" />}
          <span>{message.text}</span>
        </div>
      )}

      {loaded && passkeys.length === 0 && !compact && (
        <p className="text-[11px] text-gray-400 text-center pt-2 border-t border-gray-50">
          まだ登録されていません
        </p>
      )}

      {passkeys.length > 0 && (
        <div className="pt-3 border-t border-gray-50 space-y-2">
          <p className="text-[11px] font-semibold text-gray-500">登録済みパスキー</p>
          <ul className="space-y-1">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-700 truncate">
                    {p.device_name ?? "（名前なし）"}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    登録 {new Date(p.created_at).toLocaleDateString("ja-JP")}
                    {p.last_used_at && ` / 最終使用 ${new Date(p.last_used_at).toLocaleDateString("ja-JP")}`}
                  </p>
                </div>
                <button
                  onClick={() => remove(p.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0"
                  title="削除"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

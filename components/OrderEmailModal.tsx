"use client";

import { useState } from "react";
import { X, Mail, Loader2, Send } from "lucide-react";
import { type Event } from "@/lib/supabase";
import { type OrderEmailSettings } from "@/lib/settings";

type Props = {
  event: Event;
  settings: OrderEmailSettings;
  currentUser: string;
  onClose: () => void;
};

function extractBlock(description: string, key: string): string {
  const match = description.match(new RegExp(`【${key}】([^\n]*)`));
  return match?.[1]?.trim() ?? "";
}

function extractClientName(title: string): string {
  const match = title.match(/^(.+?) 様/);
  return match ? `${match[1]} 様` : title;
}

export default function OrderEmailModal({ event, settings, currentUser, onClose }: Props) {
  const desc = event.description ?? "";
  const [clientName] = useState(extractClientName(event.title));
  const [careOrg] = useState(extractBlock(desc, "支援事業所"));
  const [careManager] = useState(extractBlock(desc, "担当ケアマネ"));
  const [notes, setNotes] = useState(event.notes ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);

  async function handleSend() {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/send-order-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: settings.to,
          from: settings.from,
          clientName,
          careOrg,
          careManager,
          notes,
          senderName: currentUser,
        }),
      });

      if (res.ok) {
        setResult("success");
      } else {
        throw new Error();
      }
    } catch {
      // フォールバック：mailtoを開く
      const subject = encodeURIComponent(`福祉用具発注のご依頼 / ${clientName}`);
      const body = encodeURIComponent(
        [
          `利用者名：${clientName}`,
          `支援事業所：${careOrg || "（未設定）"}`,
          `担当ケアマネ：${careManager || "（未設定）"}`,
          "",
          notes ? `【備考】\n${notes}` : "",
        ].join("\n")
      );
      window.location.href = `mailto:${settings.to}?subject=${subject}&body=${body}`;
      setResult("error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-gray-100 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-indigo-500" />
            <h2 className="text-base font-bold text-gray-800">発注メール送信</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* 送信先 */}
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-xs text-gray-400 mb-0.5">送信先</p>
            <p className="text-sm font-medium text-gray-700">{settings.to}</p>
          </div>

          {/* 利用者名 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">利用者名</p>
            <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700">{clientName || "（未設定）"}</div>
          </div>

          {/* 支援事業所 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">支援事業所</p>
            <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700">{careOrg || "（未設定）"}</div>
          </div>

          {/* 担当ケアマネ */}
          <div>
            <p className="text-xs text-gray-400 mb-1">担当ケアマネ</p>
            <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700">{careManager || "（未設定）"}</div>
          </div>

          {/* 備考（編集可） */}
          <div>
            <p className="text-xs text-gray-400 mb-1">備考（編集可）</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="備考を入力..."
              className="w-full text-sm bg-gray-50 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          {/* 結果メッセージ */}
          {result === "success" && (
            <p className="text-sm text-green-600 bg-green-50 rounded-xl px-3 py-2.5">
              ✅ 送信しました
            </p>
          )}
          {result === "error" && (
            <p className="text-sm text-amber-600 bg-amber-50 rounded-xl px-3 py-2.5">
              ⚠️ 自動送信に失敗したため、メールアプリを開きました
            </p>
          )}

          {/* 送信ボタン */}
          {result !== "success" && (
            <button
              onClick={handleSend}
              disabled={sending}
              className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {sending ? (
                <><Loader2 size={16} className="animate-spin" />送信中...</>
              ) : (
                <><Send size={16} />送信する</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

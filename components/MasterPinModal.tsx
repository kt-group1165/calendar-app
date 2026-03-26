"use client";

import { useState } from "react";
import { Lock, Loader2, X } from "lucide-react";
import { verifyMasterPin } from "@/lib/settings";

type Props = {
  onSuccess: () => void;
  onClose: () => void;
};

export default function MasterPinModal({ onSuccess, onClose }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleVerify() {
    if (!pin.trim()) return;
    setLoading(true);
    setError(false);
    try {
      const ok = await verifyMasterPin(pin.trim());
      if (ok) {
        onSuccess();
      } else {
        setError(true);
        setPin("");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
              <Lock size={20} className="text-indigo-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-800">マスターログイン</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div>
          <input
            type="password"
            placeholder="PINを入力"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            autoFocus
            className={`w-full text-base border-2 rounded-xl px-4 py-3 focus:outline-none transition-colors ${
              error ? "border-red-400 bg-red-50" : "border-gray-200 focus:border-indigo-400"
            }`}
          />
          {error && <p className="text-xs text-red-500 mt-1.5">PINが正しくありません</p>}
        </div>

        <button
          onClick={handleVerify}
          disabled={loading || !pin.trim()}
          className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          ログイン
        </button>
      </div>
    </div>
  );
}

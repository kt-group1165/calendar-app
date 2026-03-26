"use client";

import { useState } from "react";
import { User, Lock, Loader2 } from "lucide-react";
import { verifyMasterPin } from "@/lib/settings";

type Props = {
  onSave: (name: string, isMaster: boolean) => void;
};

export default function UserNameModal({ onSave }: Props) {
  const [name, setName] = useState("");
  const [showMasterMode, setShowMasterMode] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      alert("名前を入力してください");
      return;
    }
    if (showMasterMode) {
      if (!pin.trim()) {
        alert("PINを入力してください");
        return;
      }
      setLoading(true);
      try {
        const ok = await verifyMasterPin(pin.trim());
        if (ok) {
          onSave(trimmed, true);
        } else {
          setPinError(true);
          setPin("");
        }
      } finally {
        setLoading(false);
      }
    } else {
      onSave(trimmed, false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center">
            <User size={28} className="text-indigo-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-800">はじめまして！</h2>
          <p className="text-sm text-gray-500">
            あなたの名前を入力してください。<br />
            予定やコメントに表示されます。
          </p>
        </div>

        <input
          type="text"
          placeholder="例：田中 太郎"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => !showMasterMode && e.key === "Enter" && handleSave()}
          autoFocus
          className="w-full text-base border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-400 transition-colors"
        />

        {showMasterMode && (
          <div>
            <input
              type="password"
              placeholder="マスターPIN"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setPinError(false); }}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className={`w-full text-base border-2 rounded-xl px-4 py-3 focus:outline-none transition-colors ${
                pinError ? "border-red-400 bg-red-50" : "border-gray-200 focus:border-indigo-400"
              }`}
            />
            {pinError && <p className="text-xs text-red-500 mt-1.5">PINが正しくありません</p>}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          {showMasterMode ? "マスターとしてはじめる" : "はじめる"}
        </button>

        <button
          onClick={() => { setShowMasterMode(!showMasterMode); setPinError(false); setPin(""); }}
          className="w-full text-xs text-gray-400 hover:text-indigo-400 transition-colors flex items-center justify-center gap-1 py-1"
        >
          <Lock size={11} />
          {showMasterMode ? "一般ユーザーとしてログイン" : "マスターとしてログイン"}
        </button>
      </div>
    </div>
  );
}

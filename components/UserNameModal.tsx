"use client";

import { useState, useEffect } from "react";
import { Lock, Loader2, Users } from "lucide-react";
import { verifyMasterPin } from "@/lib/settings";
import { getMembers, type Member } from "@/lib/members";

type Props = {
  tenantId: string;
  onSave: (name: string, isMaster: boolean) => void;
};

export default function UserNameModal({ tenantId, onSave }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [showMasterMode, setShowMasterMode] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getMembers(tenantId)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [tenantId]);

  // メンバーが0人のときは「管理者」を仮の選択肢として使う
  const options: { name: string; color: string }[] =
    members.length === 0
      ? [{ name: "管理者", color: "#6366f1" }]
      : members.map((m) => ({ name: m.name, color: m.color }));

  async function handleSave() {
    if (!selectedName) return;
    if (showMasterMode) {
      if (!pin.trim()) {
        alert("PINを入力してください");
        return;
      }
      setLoading(true);
      try {
        const ok = await verifyMasterPin(pin.trim(), tenantId);
        if (ok) {
          onSave(selectedName, true);
        } else {
          setPinError(true);
          setPin("");
        }
      } finally {
        setLoading(false);
      }
    } else {
      onSave(selectedName, false);
    }
  }

  function selectName(name: string) {
    setSelectedName(name);
    setShowMasterMode(false);
    setPin("");
    setPinError(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* タイトル（固定） */}
        <div className="flex flex-col items-center gap-2 text-center px-6 pt-6 pb-4 shrink-0">
          <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center">
            <Users size={26} className="text-indigo-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-800">あなたは誰ですか？</h2>
          <p className="text-sm text-gray-500">名前を選択してください</p>
        </div>

        {/* メンバー選択（スクロール領域） */}
        <div className="flex-1 overflow-y-auto px-6">
          {loadingMembers ? (
            <div className="flex justify-center py-4">
              <Loader2 size={22} className="animate-spin text-gray-300" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 pb-2">
              {options.map((opt) => {
                const isSelected = selectedName === opt.name;
                return (
                  <button
                    key={opt.name}
                    onClick={() => selectName(opt.name)}
                    className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all ${
                      isSelected
                        ? "border-current shadow-md scale-105"
                        : "border-gray-100 hover:border-gray-200"
                    }`}
                    style={isSelected ? { borderColor: opt.color } : {}}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-base"
                      style={{ backgroundColor: opt.color }}
                    >
                      {opt.name.charAt(0)}
                    </div>
                    <span className="text-xs font-medium text-gray-700 text-center leading-tight">
                      {opt.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* フッター（固定、選択後のみ表示領域を追加） */}
        <div className="shrink-0 px-6 pb-6 pt-2 space-y-3 border-t border-gray-100 bg-white rounded-b-2xl">
          {/* マスターPIN（選択後に表示） */}
          {selectedName && showMasterMode && (
            <div>
              <input
                type="password"
                placeholder="マスターPIN"
                value={pin}
                onChange={(e) => { setPin(e.target.value); setPinError(false); }}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                autoFocus
                className={`w-full text-base border-2 rounded-xl px-4 py-3 focus:outline-none transition-colors ${
                  pinError ? "border-red-400 bg-red-50" : "border-gray-200 focus:border-indigo-400"
                }`}
              />
              {pinError && <p className="text-xs text-red-500 mt-1.5">PINが正しくありません</p>}
            </div>
          )}

          {/* はじめるボタン */}
          {selectedName ? (
            <>
              <button
                onClick={handleSave}
                disabled={loading}
                className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {showMasterMode ? "マスターとしてはじめる" : `${selectedName} ではじめる`}
              </button>
              <button
                onClick={() => { setShowMasterMode(!showMasterMode); setPinError(false); setPin(""); }}
                className="w-full text-xs text-gray-400 hover:text-indigo-400 transition-colors flex items-center justify-center gap-1 py-1"
              >
                <Lock size={11} />
                {showMasterMode ? "一般ユーザーとしてログイン" : "マスターとしてログイン"}
              </button>
            </>
          ) : (
            <p className="text-xs text-gray-400 text-center py-2">名前を選択してください</p>
          )}
        </div>
      </div>
    </div>
  );
}

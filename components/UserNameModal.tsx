"use client";

import { useState } from "react";
import { User } from "lucide-react";

type Props = {
  onSave: (name: string) => void;
};

export default function UserNameModal({ onSave }: Props) {
  const [name, setName] = useState("");

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      alert("名前を入力してください");
      return;
    }
    onSave(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-5">
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
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
          className="w-full text-base border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-400 transition-colors"
        />

        <button
          onClick={handleSave}
          className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-xl transition-colors"
        >
          はじめる
        </button>
      </div>
    </div>
  );
}

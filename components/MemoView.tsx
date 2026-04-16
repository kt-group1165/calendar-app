"use client";

import { useState, useEffect } from "react";
import { X, StickyNote, RefreshCw, ChevronRight, Users } from "lucide-react";
import { type Event } from "@/lib/supabase";
import { getMemoEvents } from "@/lib/events";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

type Props = {
  tenantId: string;
  onEventClick: (event: Event) => void;
  onClose: () => void;
};

export default function MemoView({ tenantId, onEventClick, onClose }: Props) {
  const [memos, setMemos] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setMemos(await getMemoEvents(tenantId));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f8f9fa]">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <StickyNote size={20} className="text-amber-500" />
          <h2 className="text-base font-bold text-gray-800">メモ（日付未定）</h2>
          {!loading && (
            <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-0.5 rounded-full">
              {memos.length}件
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={load} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <RefreshCw size={16} className={`text-gray-400 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex justify-center pt-20">
            <RefreshCw size={24} className="text-indigo-400 animate-spin" />
          </div>
        ) : memos.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 gap-3 text-gray-400">
            <StickyNote size={48} className="text-gray-200" />
            <p className="text-sm">メモはありません</p>
            <p className="text-xs text-center text-gray-300">
              予定追加時に「日付未定（メモ）」を選ぶと<br />ここに表示されます
            </p>
          </div>
        ) : (
          memos.map((memo) => (
            <button
              key={memo.id}
              onClick={() => onEventClick(memo)}
              className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-left hover:border-amber-300 hover:shadow-md transition-all active:bg-amber-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {/* カラーバー＋タイトル */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: memo.color || "#6366f1" }} />
                    <p className="text-sm font-semibold text-gray-800 truncate">{memo.title}</p>
                  </div>

                  {/* 担当者 */}
                  {memo.assignees.length > 0 && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <Users size={11} className="text-gray-300 shrink-0" />
                      <p className="text-xs text-gray-400 truncate">{memo.assignees.join("・")}</p>
                    </div>
                  )}

                  {/* メモ（description） */}
                  {memo.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                      {memo.description}
                    </p>
                  )}

                  {/* 作成日 */}
                  <p className="text-[10px] text-gray-300 mt-2">
                    {format(new Date(memo.created_at), "yyyy/M/d(E) HH:mm", { locale: ja })} 作成
                  </p>
                </div>
                <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

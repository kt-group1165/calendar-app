"use client";

import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { X, Search, Loader2 } from "lucide-react";
import { searchEvents } from "@/lib/events";
import { type Event } from "@/lib/supabase";

type Props = {
  tenantId: string;
  onEventClick: (event: Event) => void;
  onClose: () => void;
};

export default function SearchView({ tenantId, onEventClick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Event[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- HANDOVER §2 (mount-time async fetch / mount init)
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await searchEvents(query.trim(), tenantId);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query]);

  // 検索ヒット箇所を可視化するためのスニペット生成
  // タイトル以外で一致したフィールドを優先表示
  function getSnippet(event: Event, q: string): { label: string; text: string } | null {
    if (!q) return null;
    const lowered = q.toLowerCase();
    const candidates: Array<{ label: string; text: string | null }> = [
      { label: "メモ", text: event.description },
      { label: "備考", text: event.notes },
      { label: "場所", text: event.location },
      { label: "その他", text: event.visit_other_detail },
    ];
    for (const c of candidates) {
      if (c.text && c.text.toLowerCase().includes(lowered)) {
        return { label: c.label, text: c.text };
      }
    }
    // 担当者・種別の配列もチェック
    const assigneeHit = (event.assignees ?? []).find((a) => a.toLowerCase().includes(lowered));
    if (assigneeHit) return { label: "担当者", text: (event.assignees ?? []).join("・") };
    const typeHit = (event.event_type ?? []).find((t) => t.toLowerCase().includes(lowered));
    if (typeHit) return { label: "種別", text: (event.event_type ?? []).join("・") };
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa]">
      {/* 検索バー */}
      <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2 shadow-sm">
        <Search size={16} className="text-gray-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="タイトル・メモ・備考・場所・担当者・種別を検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 text-sm outline-none text-gray-800 placeholder-gray-300 py-1"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        )}
        <button
          onClick={onClose}
          className="ml-1 text-sm text-indigo-500 font-medium px-1 py-1"
        >
          キャンセル
        </button>
      </div>

      {/* 結果リスト */}
      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <div className="flex justify-center py-16">
            <Loader2 size={22} className="animate-spin text-gray-300" />
          </div>
        ) : query.trim() === "" ? (
          <div className="text-center py-20 text-gray-300">
            <Search size={40} className="mx-auto mb-3" />
            <p className="text-sm">タイトル・メモ・備考・場所・担当者・種別から検索</p>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-gray-400">「{query}」の予定は見つかりません</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            <p className="text-xs text-gray-400 px-4 py-2 bg-white border-b border-gray-100">
              {results.length}件{results.length >= 50 ? "（上限50件）" : ""}
            </p>
            {results.map((event) => {
              const titleHit = event.title.toLowerCase().includes(query.trim().toLowerCase());
              const snippet = !titleHit ? getSnippet(event, query.trim()) : null;
              return (
                <button
                  key={event.id}
                  onClick={() => onEventClick(event)}
                  className="w-full flex items-center px-4 bg-white hover:bg-gray-50 active:bg-gray-100 text-left gap-3 py-3"
                >
                  {/* カラーバー */}
                  <div
                    className="w-[3px] self-stretch rounded-full shrink-0"
                    style={{ backgroundColor: event.color }}
                  />
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                    <p className="text-sm font-semibold text-gray-800 truncate">{event.title}</p>
                    <p className="text-xs text-gray-400 leading-none">
                      {format(new Date(event.start_date), "yyyy年M月d日")}
                      {!event.all_day && event.start_time
                        ? `  ${event.start_time.slice(0, 5)}${event.end_time ? `〜${event.end_time.slice(0, 5)}` : ""}`
                        : "  終日"}
                    </p>
                    <p className="text-xs text-gray-400 leading-none truncate h-[14px]">
                      {event.assignees?.length > 0 ? event.assignees.join("・") : ""}
                    </p>
                    {snippet && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2 break-words">
                        <span className="text-amber-600 font-semibold mr-1">{snippet.label}:</span>
                        {snippet.text}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

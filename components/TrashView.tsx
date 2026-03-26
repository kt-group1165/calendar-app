"use client";

import { useState, useEffect } from "react";
import { X, RotateCcw, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { type Event } from "@/lib/supabase";
import { getDeletedEvents, restoreEvent, permanentDeleteEvent } from "@/lib/events";

type Props = {
  isMaster: boolean;
  onClose: () => void;
  onRestored: () => void;
};

export default function TrashView({ isMaster, onClose, onRestored }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await getDeletedEvents();
      setEvents(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(event: Event) {
    setProcessing(event.id);
    try {
      await restoreEvent(event.id);
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
      onRestored();
    } finally {
      setProcessing(null);
    }
  }

  async function handlePermanentDelete(event: Event) {
    if (!confirm("完全に削除します。元に戻せません。よろしいですか？")) return;
    setProcessing(event.id);
    try {
      await permanentDeleteEvent(event.id, event.image_url);
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
    } finally {
      setProcessing(null);
    }
  }

  function daysLeft(deletedAt: string): number {
    const expiry = new Date(new Date(deletedAt).getTime() + 10 * 24 * 60 * 60 * 1000);
    return Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shadow-sm shrink-0">
        <div className="flex items-center gap-2">
          <Trash2 size={18} className="text-gray-500" />
          <h2 className="text-base font-bold text-gray-800">ゴミ箱</h2>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100">
          <X size={20} className="text-gray-500" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-xs text-gray-400 mb-4">削除から10日後に自動的に完全削除されます</p>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-300">
            <Trash2 size={48} className="mb-3" />
            <p className="text-sm">ゴミ箱は空です</p>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
                <div className="w-2.5 h-12 rounded-full shrink-0" style={{ backgroundColor: event.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{event.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {format(new Date(event.start_date), "M月d日(E)", { locale: ja })}
                    {event.start_date !== event.end_date &&
                      ` 〜 ${format(new Date(event.end_date), "M月d日", { locale: ja })}`}
                  </p>
                  {event.deleted_at && (
                    <p className={`text-xs mt-0.5 ${daysLeft(event.deleted_at) <= 2 ? "text-red-400" : "text-orange-400"}`}>
                      あと{daysLeft(event.deleted_at)}日で自動削除
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => handleRestore(event)}
                    disabled={processing === event.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50"
                  >
                    {processing === event.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    復元
                  </button>
                  {isMaster && (
                    <button
                      onClick={() => handlePermanentDelete(event)}
                      disabled={processing === event.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 text-red-500 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      完全削除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

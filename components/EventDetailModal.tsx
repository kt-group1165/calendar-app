"use client";

import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { X, Edit2, Trash2, Clock, AlignLeft, Image as ImageIcon, Loader2 } from "lucide-react";
import { useState } from "react";
import { type Event } from "@/lib/supabase";

type Props = {
  event: Event;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
};

export default function EventDetailModal({ event, onEdit, onDelete, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("この予定を削除しますか？")) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  const startDate = format(new Date(event.start_date), "M月d日(E)", { locale: ja });
  const endDate = format(new Date(event.end_date), "M月d日(E)", { locale: ja });
  const isSameDay = event.start_date === event.end_date;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        {/* カラーバー */}
        <div className="h-2" style={{ backgroundColor: event.color }} />

        {/* ヘッダー */}
        <div className="flex items-start justify-between px-4 pt-3 pb-0">
          <h2 className="text-xl font-bold text-gray-800 flex-1 pr-2 leading-snug">
            {event.title}
          </h2>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-2 rounded-full hover:bg-red-50 transition-colors text-gray-400 hover:text-red-400"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3 mt-3">
          {/* 日付・時間 */}
          <div className="flex items-center gap-2 text-gray-600">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: event.color + "20" }}
            >
              <span style={{ color: event.color }} className="text-sm">📅</span>
            </div>
            <div>
              <p className="text-sm font-medium">
                {isSameDay ? startDate : `${startDate} 〜 ${endDate}`}
              </p>
              {!event.all_day && (event.start_time || event.end_time) && (
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                  <Clock size={10} />
                  {event.start_time?.slice(0, 5)}
                  {event.end_time && ` 〜 ${event.end_time.slice(0, 5)}`}
                </p>
              )}
              {event.all_day && <p className="text-xs text-gray-400 mt-0.5">終日</p>}
            </div>
          </div>

          {/* メモ */}
          {event.description && (
            <div className="flex items-start gap-2 text-gray-600">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <AlignLeft size={14} className="text-gray-400" />
              </div>
              <p className="text-sm leading-relaxed pt-1">{event.description}</p>
            </div>
          )}

          {/* 画像 */}
          {event.image_url && (
            <div className="rounded-xl overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={event.image_url}
                alt="添付画像"
                className="w-full max-h-64 object-cover"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { format, isToday } from "date-fns";
import { Clock, Image as ImageIcon, X } from "lucide-react";
import { type Event } from "@/lib/supabase";

type Props = {
  currentDate: Date;
  events: Event[];
  onEventClick: (event: Event) => void;
  onClose?: () => void;
};

export default function DayView({ currentDate, events, onEventClick, onClose }: Props) {
  const dateStr = format(currentDate, "yyyy-MM-dd");
  const dayEvents = events.filter(
    (e) => e.start_date <= dateStr && e.end_date >= dateStr
  );
  const today = isToday(currentDate);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* 日付ヘッダー */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center font-bold shadow-sm shrink-0 ${
            today ? "bg-indigo-500 text-white" : "bg-white text-gray-700"
          }`}
        >
          <span className="text-xs opacity-70">
            {["日", "月", "火", "水", "木", "金", "土"][currentDate.getDay()]}
          </span>
          <span className="text-2xl leading-none">{format(currentDate, "d")}</span>
        </div>
        <div className="flex-1">
          <p className="text-lg font-semibold text-gray-800">
            {format(currentDate, "yyyy年M月d日")}
          </p>
          <p className="text-sm text-gray-400">{dayEvents.length}件の予定</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-400"
            title="閉じる"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* イベントリスト */}
      {dayEvents.length === 0 ? (
        <div className="text-center py-16 text-gray-300">
          <div className="text-5xl mb-3">📅</div>
          <p className="text-sm">予定はありません</p>
          <p className="text-xs mt-1">＋ボタンで追加できます</p>
        </div>
      ) : (
        <div className="space-y-3">
          {dayEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className="w-full text-left bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
            >
              <div
                className="h-1.5"
                style={{ backgroundColor: event.color }}
              />
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-800 text-base leading-snug">
                    {event.title}
                  </h3>
                  {event.image_url && (
                    <ImageIcon size={14} className="text-gray-300 mt-0.5 shrink-0" />
                  )}
                </div>

                {!event.all_day && (event.start_time || event.end_time) && (
                  <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-400">
                    <Clock size={12} />
                    <span>
                      {event.start_time?.slice(0, 5)}
                      {event.end_time && ` 〜 ${event.end_time.slice(0, 5)}`}
                    </span>
                  </div>
                )}

                {event.description && (
                  <p className="mt-1.5 text-sm text-gray-500 line-clamp-2">
                    {event.description}
                  </p>
                )}

                {event.image_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={event.image_url}
                    alt=""
                    className="mt-2 w-full h-28 object-cover rounded-lg"
                  />
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

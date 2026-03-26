"use client";

import { format, isToday } from "date-fns";
import { ja } from "date-fns/locale";
import { Image as ImageIcon, X } from "lucide-react";
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

  const allDayEvents = dayEvents.filter((e) => e.all_day || !e.start_time);
  const timedEvents = dayEvents
    .filter((e) => !e.all_day && e.start_time)
    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 日付ヘッダー */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
        <div
          className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center font-bold shadow-sm shrink-0 ${
            today ? "bg-indigo-500 text-white" : "bg-gray-50 text-gray-700"
          }`}
        >
          <span className="text-[10px] opacity-70">
            {["日","月","火","水","木","金","土"][currentDate.getDay()]}
          </span>
          <span className="text-xl leading-none">{format(currentDate, "d")}</span>
        </div>
        <div className="flex-1">
          <p className="text-base font-semibold text-gray-800">
            {format(currentDate, "yyyy年M月d日(E)", { locale: ja })}
          </p>
          <p className="text-xs text-gray-400">{dayEvents.length}件の予定</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-400"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {dayEvents.length === 0 ? (
        <div className="text-center py-16 text-gray-300">
          <div className="text-5xl mb-3">📅</div>
          <p className="text-sm">予定はありません</p>
          <p className="text-xs mt-1">＋ボタンで追加できます</p>
        </div>
      ) : (
        <div className="pb-8">
          {/* 全イベントを同じ行デザインで表示（終日→時間あり順） */}
          {[...allDayEvents, ...timedEvents].map((event) => (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className="w-full flex items-center hover:bg-gray-50 active:bg-gray-100 transition-colors px-2"
              style={{ height: "68px" }}
            >
              {/* 時刻（終日の場合は「終日」表示） */}
              <div className="w-14 shrink-0 flex flex-col items-end pr-3 gap-1">
                {event.all_day || !event.start_time ? (
                  <span className="text-xs font-bold text-gray-400 leading-none">終日</span>
                ) : (
                  <>
                    <span className="text-xs font-bold text-gray-700 leading-none tabular-nums">
                      {event.start_time.slice(0, 5)}
                    </span>
                    {event.end_time && (
                      <span className="text-xs text-gray-400 leading-none tabular-nums">
                        {event.end_time.slice(0, 5)}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* カラーバー */}
              <div
                className="w-[3px] self-stretch rounded-full shrink-0 my-3"
                style={{ backgroundColor: event.color }}
              />

              {/* 内容（タイトル・メモ・担当者の3行固定レイアウト） */}
              <div className="flex-1 pl-3 text-left min-w-0 pr-1 flex flex-col justify-center gap-0.5">
                {/* 行1: タイトル */}
                <p className="text-sm font-semibold text-gray-800 leading-snug truncate">
                  {event.title}
                </p>
                {/* 行2: メモ（空でも高さを確保） */}
                <p className="text-xs text-gray-400 leading-none truncate h-[14px]">
                  {event.description ?? ""}
                </p>
                {/* 行3: 担当者（空でも高さを確保） */}
                <p className="text-xs text-gray-400 leading-none truncate h-[14px]">
                  {event.assignees?.length > 0 ? event.assignees.join("・") : ""}
                </p>
              </div>

              {event.image_url && (
                <ImageIcon size={12} className="text-gray-300 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

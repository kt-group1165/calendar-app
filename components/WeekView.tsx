"use client";

import {
  format,
  startOfWeek,
  addDays,
  isToday,
  isSameDay,
} from "date-fns";
import { ja } from "date-fns/locale";
import { type Event } from "@/lib/supabase";

type Props = {
  currentDate: Date;
  events: Event[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: Event) => void;
};

const WEEKDAYS_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

function getEventsForDay(events: Event[], date: Date): Event[] {
  const dateStr = format(date, "yyyy-MM-dd");
  return events.filter((e) => e.start_date <= dateStr && e.end_date >= dateStr);
}

export default function WeekView({ currentDate, events, onDayClick, onEventClick }: Props) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 border-b border-gray-100 sticky top-0 bg-white z-10">
        {days.map((day, i) => {
          const today = isToday(day);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className="text-center py-2 flex flex-col items-center gap-0.5 hover:bg-indigo-50/50 transition-colors"
            >
              <span
                className={`text-xs font-medium ${
                  i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-400"
                }`}
              >
                {WEEKDAYS_SHORT[i]}
              </span>
              <span
                className={`w-8 h-8 flex items-center justify-center text-sm font-semibold rounded-full ${
                  today
                    ? "bg-indigo-500 text-white"
                    : isSameDay(day, currentDate)
                    ? "bg-indigo-100 text-indigo-600"
                    : "text-gray-700"
                }`}
              >
                {format(day, "d")}
              </span>
            </button>
          );
        })}
      </div>

      {/* イベント行 */}
      <div className="grid grid-cols-7 min-h-[calc(100vh-220px)]">
        {days.map((day, i) => {
          const dayEvents = getEventsForDay(events, day);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`border-r border-gray-100 p-1 text-left min-h-32 transition-colors hover:bg-indigo-50/30 ${
                i === 0 ? "border-l-0" : ""
              }`}
            >
              <div className="space-y-1">
                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                    className="text-[11px] leading-5 px-1.5 py-0.5 rounded-md font-medium text-white truncate"
                    style={{ backgroundColor: event.color }}
                  >
                    {!event.all_day && event.start_time && (
                      <span className="opacity-80 mr-1">{event.start_time.slice(0, 5)}</span>
                    )}
                    {event.title}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

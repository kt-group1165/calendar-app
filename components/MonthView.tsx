"use client";

import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
} from "date-fns";
import { ja } from "date-fns/locale";
import { type Event } from "@/lib/supabase";

type Props = {
  currentDate: Date;
  events: Event[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: Event) => void;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function getEventsForDay(events: Event[], date: Date): Event[] {
  const dateStr = format(date, "yyyy-MM-dd");
  return events.filter((e) => e.start_date <= dateStr && e.end_date >= dateStr);
}

export default function MonthView({ currentDate, events, onDayClick, onEventClick }: Props) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div className="flex-1 flex flex-col">
      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAYS.map((day, i) => (
          <div
            key={day}
            className={`text-center text-xs font-semibold py-2 ${
              i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-400"
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* カレンダーグリッド */}
      <div className="grid grid-cols-7 flex-1">
        {days.map((day, idx) => {
          const dayEvents = getEventsForDay(events, day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const today = isToday(day);
          const dayOfWeek = day.getDay();

          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`
                relative border-b border-r border-gray-100 p-1 text-left transition-colors min-h-[72px]
                ${isCurrentMonth ? "bg-white hover:bg-indigo-50/50" : "bg-gray-50/50"}
                ${idx % 7 === 0 ? "border-l-0" : ""}
              `}
            >
              {/* 日付 */}
              <span
                className={`
                  inline-flex w-6 h-6 items-center justify-center text-xs font-medium rounded-full mb-1
                  ${today ? "bg-indigo-500 text-white" : ""}
                  ${!today && isCurrentMonth
                    ? dayOfWeek === 0
                      ? "text-red-400"
                      : dayOfWeek === 6
                      ? "text-blue-400"
                      : "text-gray-700"
                    : "text-gray-300"
                  }
                `}
              >
                {format(day, "d")}
              </span>

              {/* イベント */}
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event, i) => (
                  <div
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                    className="truncate text-[10px] leading-4 px-1 rounded font-medium text-white"
                    style={{ backgroundColor: event.color }}
                  >
                    {event.title}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-gray-400 pl-1">
                    +{dayEvents.length - 3}件
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

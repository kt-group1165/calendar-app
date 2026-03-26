"use client";

import { useEffect, useRef } from "react";
import { format, startOfWeek, addDays, isToday, isSameDay } from "date-fns";
import { type Event } from "@/lib/supabase";

type Props = {
  currentDate: Date;
  events: Event[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: Event) => void;
};

const HOUR_HEIGHT = 64;   // px / hour
const START_HOUR = 6;
const END_HOUR = 23;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const MIN_EVENT_HEIGHT = 22;
const WEEKDAYS_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

type LayoutEvent = { event: Event; col: number; cols: number };

function layoutDayEvents(events: Event[]): LayoutEvent[] {
  const timed = events
    .filter((e) => !e.all_day && e.start_time)
    .sort((a, b) => timeToMin(a.start_time!) - timeToMin(b.start_time!));

  if (timed.length === 0) return [];

  const getEnd = (e: Event) =>
    e.end_time ? timeToMin(e.end_time) : timeToMin(e.start_time!) + 60;

  // 重複グループを BFS で検出
  const visited = new Set<string>();
  const groups: Event[][] = [];

  for (const ev of timed) {
    if (visited.has(ev.id)) continue;
    const group: Event[] = [];
    const queue = [ev];
    visited.add(ev.id);
    while (queue.length) {
      const cur = queue.shift()!;
      group.push(cur);
      for (const other of timed) {
        if (
          !visited.has(other.id) &&
          timeToMin(cur.start_time!) < getEnd(other) &&
          timeToMin(other.start_time!) < getEnd(cur)
        ) {
          visited.add(other.id);
          queue.push(other);
        }
      }
    }
    groups.push(group);
  }

  const result: LayoutEvent[] = [];

  for (const group of groups) {
    const sorted = [...group].sort(
      (a, b) => timeToMin(a.start_time!) - timeToMin(b.start_time!)
    );
    const colEnds: number[] = [];

    for (const ev of sorted) {
      const start = timeToMin(ev.start_time!);
      const end = getEnd(ev);
      let col = colEnds.findIndex((e) => e <= start);
      if (col < 0) col = colEnds.length;
      colEnds[col] = end;
      result.push({ event: ev, col, cols: 0 });
    }

    const totalCols = colEnds.length;
    for (let i = result.length - group.length; i < result.length; i++) {
      result[i] = { ...result[i], cols: totalCols };
    }
  }

  return result;
}

function CurrentTimeLine() {
  const now = new Date();
  const top = ((now.getHours() * 60 + now.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  if (top < 0 || top > TOTAL_HOURS * HOUR_HEIGHT) return null;
  return (
    <div className="absolute w-full z-10 pointer-events-none" style={{ top: `${top}px` }}>
      <div className="absolute w-2 h-2 rounded-full bg-red-500 -left-1 -translate-y-1/2" />
      <div className="border-t-2 border-red-400 w-full" />
    </div>
  );
}

function getEventsForDay(events: Event[], date: Date): Event[] {
  const dateStr = format(date, "yyyy-MM-dd");
  return events.filter((e) => e.start_date <= dateStr && e.end_date >= dateStr);
}

export default function WeekView({ currentDate, events, onDayClick, onEventClick }: Props) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const scrollRef = useRef<HTMLDivElement>(null);

  // 現在時刻付近に自動スクロール
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const top = Math.max(
        0,
        ((now.getHours() * 60 + now.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT - 100
      );
      scrollRef.current.scrollTop = top;
    }
  }, []);

  const allDayByDay = days.map((day) =>
    getEventsForDay(events, day).filter((e) => e.all_day || !e.start_time)
  );
  const hasAllDay = allDayByDay.some((d) => d.length > 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* 曜日ヘッダー（sticky） */}
      <div className="flex shrink-0 border-b border-gray-100 bg-white sticky top-0 z-20">
        <div className="w-10 shrink-0" />
        {days.map((day, i) => {
          const today = isToday(day);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className="flex-1 text-center py-2 flex flex-col items-center gap-0.5 hover:bg-indigo-50/50 transition-colors min-w-0"
            >
              <span className={`text-[10px] font-medium ${
                i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-400"
              }`}>
                {WEEKDAYS_SHORT[i]}
              </span>
              <span className={`w-7 h-7 flex items-center justify-center text-xs font-semibold rounded-full ${
                today
                  ? "bg-indigo-500 text-white"
                  : isSameDay(day, currentDate)
                  ? "bg-indigo-100 text-indigo-600"
                  : "text-gray-700"
              }`}>
                {format(day, "d")}
              </span>
            </button>
          );
        })}
      </div>

      {/* 終日イベント行 */}
      {hasAllDay && (
        <div className="flex shrink-0 border-b border-gray-100 bg-white">
          <div className="w-10 shrink-0 flex items-center justify-end pr-1 py-1">
            <span className="text-[9px] text-gray-400 leading-none">終日</span>
          </div>
          {days.map((day, i) => (
            <div
              key={day.toISOString()}
              className="flex-1 border-l border-gray-100 px-0.5 py-0.5 space-y-0.5 min-w-0"
            >
              {allDayByDay[i].map((event) => (
                <button
                  key={event.id}
                  onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                  className="w-full text-left text-[9px] font-semibold text-white px-1 py-0.5 rounded truncate leading-none"
                  style={{ backgroundColor: event.color }}
                >
                  {event.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* タイムグリッド（スクロール） */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="flex" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}>

          {/* 時刻軸 */}
          <div className="w-10 shrink-0 relative select-none">
            {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
              <div
                key={i}
                className="absolute text-[9px] text-gray-400 text-right pr-1.5 w-full leading-none"
                style={{ top: `${i * HOUR_HEIGHT - 5}px` }}
              >
                {i > 0 && START_HOUR + i <= 24
                  ? `${String(START_HOUR + i).padStart(2, "0")}:00`
                  : ""}
              </div>
            ))}
          </div>

          {/* 日別列 */}
          {days.map((day) => {
            const dayAllEvents = getEventsForDay(events, day);
            const laid = layoutDayEvents(dayAllEvents);

            return (
              <div
                key={day.toISOString()}
                className="flex-1 relative border-l border-gray-100"
                onClick={() => onDayClick(day)}
              >
                {/* 時間グリッド線 */}
                {Array.from({ length: TOTAL_HOURS }, (_, j) => (
                  <div
                    key={j}
                    className="absolute w-full border-t border-gray-100"
                    style={{ top: `${j * HOUR_HEIGHT}px` }}
                  />
                ))}
                {/* 30分ライン */}
                {Array.from({ length: TOTAL_HOURS }, (_, j) => (
                  <div
                    key={`h${j}`}
                    className="absolute w-full border-t border-gray-50"
                    style={{ top: `${j * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` }}
                  />
                ))}

                {/* 現在時刻ライン */}
                {isToday(day) && <CurrentTimeLine />}

                {/* イベント */}
                {laid.map(({ event, col, cols }) => {
                  const startMin = timeToMin(event.start_time!);
                  const endMin = event.end_time
                    ? timeToMin(event.end_time)
                    : startMin + 60;
                  const top = ((startMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                  const height = Math.max(
                    ((endMin - startMin) / 60) * HOUR_HEIGHT,
                    MIN_EVENT_HEIGHT
                  );
                  const pct = 100 / cols;

                  return (
                    <div
                      key={event.id}
                      className="absolute rounded overflow-hidden cursor-pointer border border-white/40 hover:brightness-110 active:brightness-90 transition-all z-[1]"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `${col * pct}%`,
                        width: `${pct}%`,
                        backgroundColor: event.color,
                      }}
                      onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                    >
                      <div className="px-1 pt-0.5">
                        <p className="text-[10px] font-semibold text-white leading-snug line-clamp-2">
                          {event.title}
                        </p>
                        {height >= 38 && (
                          <p className="text-[9px] text-white/80 leading-none mt-0.5">
                            {event.start_time?.slice(0, 5)}
                            {event.end_time && `〜${event.end_time.slice(0, 5)}`}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

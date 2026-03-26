"use client";

import { useState, useEffect, useCallback } from "react";
import {
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Calendar, RefreshCw } from "lucide-react";
import MonthView from "@/components/MonthView";
import WeekView from "@/components/WeekView";
import DayView from "@/components/DayView";
import EventModal from "@/components/EventModal";
import EventDetailModal from "@/components/EventDetailModal";
import { type Event, type EventInsert } from "@/lib/supabase";
import {
  getEventsByDateRange,
  createEvent,
  updateEvent,
  deleteEvent,
  deleteImage,
} from "@/lib/events";

type ViewMode = "month" | "week" | "day";

function getDateRange(date: Date, mode: ViewMode): { start: string; end: string } {
  if (mode === "month") {
    const s = startOfWeek(startOfMonth(date), { weekStartsOn: 0 });
    const e = endOfWeek(endOfMonth(date), { weekStartsOn: 0 });
    return { start: format(s, "yyyy-MM-dd"), end: format(e, "yyyy-MM-dd") };
  } else if (mode === "week") {
    const s = startOfWeek(date, { weekStartsOn: 0 });
    const e = endOfWeek(date, { weekStartsOn: 0 });
    return { start: format(s, "yyyy-MM-dd"), end: format(e, "yyyy-MM-dd") };
  } else {
    const d = format(date, "yyyy-MM-dd");
    return { start: d, end: d };
  }
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [supabaseError, setSupabaseError] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange(currentDate, viewMode);
      const data = await getEventsByDateRange(start, end);
      setEvents(data);
      setSupabaseError(false);
    } catch {
      setSupabaseError(true);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [currentDate, viewMode]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  function navigate(dir: 1 | -1) {
    if (viewMode === "month") {
      setCurrentDate((d) => (dir === 1 ? addMonths(d, 1) : subMonths(d, 1)));
    } else if (viewMode === "week") {
      setCurrentDate((d) => (dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1)));
    } else {
      setCurrentDate((d) => (dir === 1 ? addDays(d, 1) : subDays(d, 1)));
    }
  }

  function getHeaderTitle() {
    if (viewMode === "month") {
      return format(currentDate, "yyyy年M月", { locale: ja });
    } else if (viewMode === "week") {
      const s = startOfWeek(currentDate, { weekStartsOn: 0 });
      const e = endOfWeek(currentDate, { weekStartsOn: 0 });
      return `${format(s, "M/d")} 〜 ${format(e, "M/d")}`;
    } else {
      return format(currentDate, "M月d日(E)", { locale: ja });
    }
  }

  function handleDayClick(date: Date) {
    if (viewMode === "month" || viewMode === "week") {
      setCurrentDate(date);
      setViewMode("day");
    } else {
      setSelectedDate(date);
      setShowAddModal(true);
    }
  }

  function handleEventClick(event: Event) {
    setSelectedEvent(event);
    setShowDetailModal(true);
  }

  async function handleSaveEvent(data: EventInsert) {
    if (editingEvent) {
      const updated = await updateEvent(editingEvent.id, data);
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } else {
      const created = await createEvent(data);
      setEvents((prev) => [...prev, created]);
    }
    setShowAddModal(false);
    setEditingEvent(null);
    setSelectedDate(null);
    await loadEvents();
  }

  async function handleDeleteEvent(event: Event) {
    if (event.image_url) {
      try {
        await deleteImage(event.image_url);
      } catch {
        /* ignore */
      }
    }
    await deleteEvent(event.id);
    setEvents((prev) => prev.filter((e) => e.id !== event.id));
    setShowDetailModal(false);
    setSelectedEvent(null);
  }

  function handleEditFromDetail() {
    setShowDetailModal(false);
    setEditingEvent(selectedEvent);
    setShowAddModal(true);
  }

  return (
    <div className="flex flex-col h-dvh max-h-dvh bg-[#f8f9fa]">
      {/* トップバー */}
      <header className="bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentDate(new Date())}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
            title="今日へ"
          >
            <Calendar size={20} className="text-indigo-500" />
          </button>
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <button
            onClick={() => navigate(1)}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <ChevronRight size={20} className="text-gray-600" />
          </button>
        </div>

        <h1 className="text-base font-bold text-gray-800 select-none">
          {getHeaderTitle()}
        </h1>

        <div className="flex items-center gap-1">
          {loading && <RefreshCw size={14} className="text-indigo-400 animate-spin" />}
          <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
            {(["month", "week", "day"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${
                  viewMode === mode
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {mode === "month" ? "月" : mode === "week" ? "週" : "日"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Supabase未設定の警告 */}
      {supabaseError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-700">
          ⚠️ Supabaseが未設定です。
          <code className="bg-amber-100 px-1 rounded mx-1">.env.local</code>
          にURLとキーを設定してください。
        </div>
      )}

      {/* メインビュー */}
      <main className="flex-1 overflow-hidden flex flex-col bg-white">
        {viewMode === "month" && (
          <MonthView
            currentDate={currentDate}
            events={events}
            onDayClick={handleDayClick}
            onEventClick={handleEventClick}
          />
        )}
        {viewMode === "week" && (
          <WeekView
            currentDate={currentDate}
            events={events}
            onDayClick={handleDayClick}
            onEventClick={handleEventClick}
          />
        )}
        {viewMode === "day" && (
          <DayView
            currentDate={currentDate}
            events={events}
            onEventClick={handleEventClick}
          />
        )}
      </main>

      {/* 追加ボタン */}
      <button
        onClick={() => {
          setEditingEvent(null);
          setSelectedDate(currentDate);
          setShowAddModal(true);
        }}
        className="fixed bottom-6 right-5 w-14 h-14 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center active:scale-95"
        aria-label="予定を追加"
      >
        <Plus size={28} />
      </button>

      {/* 予定追加/編集モーダル */}
      {showAddModal && (
        <EventModal
          event={editingEvent}
          defaultDate={selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined}
          onSave={handleSaveEvent}
          onDelete={editingEvent ? () => handleDeleteEvent(editingEvent) : undefined}
          onClose={() => {
            setShowAddModal(false);
            setEditingEvent(null);
          }}
        />
      )}

      {/* 予定詳細モーダル */}
      {showDetailModal && selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onEdit={handleEditFromDetail}
          onDelete={() => handleDeleteEvent(selectedEvent)}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedEvent(null);
          }}
        />
      )}
    </div>
  );
}

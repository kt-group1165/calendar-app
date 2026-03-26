"use client";

import { useState, useEffect, useCallback } from "react";
import {
  format, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
} from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Calendar, RefreshCw, Trash2, Settings, Bell, Search } from "lucide-react";
import MonthView from "@/components/MonthView";
import WeekView from "@/components/WeekView";
import DayView from "@/components/DayView";
import EventModal from "@/components/EventModal";
import EventDetailModal from "@/components/EventDetailModal";
import UserNameModal from "@/components/UserNameModal";
import MasterPinModal from "@/components/MasterPinModal";
import TrashView from "@/components/TrashView";
import AdminPanel from "@/components/AdminPanel";
import ActivityLogView from "@/components/ActivityLogView";
import SearchView from "@/components/SearchView";
import { type Event, type EventInsert } from "@/lib/supabase";
import {
  getEventsByDateRange, getEventById, createEvent, updateEvent,
  softDeleteEvent, cleanupOldDeletedEvents,
  logActivity, getUnreadActivityCount,
} from "@/lib/events";
import { getMembers, type Member } from "@/lib/members";
import { getGroups, type MemberGroup } from "@/lib/groups";

const LAST_SEEN_KEY = "calendar_activity_last_seen";

type ViewMode = "month" | "week" | "day";
const USER_NAME_KEY = "calendar_user_name";
const IS_MASTER_KEY = "calendar_is_master";

function getDateRange(date: Date, mode: ViewMode) {
  if (mode === "month") {
    return {
      start: format(startOfWeek(startOfMonth(date), { weekStartsOn: 0 }), "yyyy-MM-dd"),
      end: format(endOfWeek(endOfMonth(date), { weekStartsOn: 0 }), "yyyy-MM-dd"),
    };
  } else if (mode === "week") {
    return {
      start: format(startOfWeek(date, { weekStartsOn: 0 }), "yyyy-MM-dd"),
      end: format(endOfWeek(date, { weekStartsOn: 0 }), "yyyy-MM-dd"),
    };
  } else {
    const d = format(date, "yyyy-MM-dd");
    return { start: d, end: d };
  }
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [previousViewMode, setPreviousViewMode] = useState<ViewMode>("month");
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [supabaseError, setSupabaseError] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [isMaster, setIsMaster] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showMasterPin, setShowMasterPin] = useState(false);
  const [duplicateData, setDuplicateData] = useState<EventInsert | null>(null);

  // 年月ピッカー
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());

  // 担当者フィルター
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  const [filterMembers, setFilterMembers] = useState<string[]>([]);
  const [filterGroups, setFilterGroups] = useState<string[]>([]);

  // 活動ログ・通知
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const name = localStorage.getItem(USER_NAME_KEY);
    const master = localStorage.getItem(IS_MASTER_KEY) === "true";
    setCurrentUser(name ?? "");
    if (master) setIsMaster(true);
    cleanupOldDeletedEvents().catch(() => {});
    getMembers().then(setMembers).catch(() => {});
    getGroups().then(setGroups).catch(() => {});

    // 未読件数を取得
    const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    if (!lastSeen) {
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    } else {
      getUnreadActivityCount(lastSeen).then(setUnreadCount).catch(() => {});
    }
  }, []);

  function handleUserNameSave(name: string, master: boolean) {
    localStorage.setItem(USER_NAME_KEY, name);
    if (master) {
      localStorage.setItem(IS_MASTER_KEY, "true");
      setIsMaster(true);
    }
    setCurrentUser(name);
  }

  function handleMasterLoginSuccess() {
    localStorage.setItem(IS_MASTER_KEY, "true");
    setIsMaster(true);
    setShowMasterPin(false);
    setShowAdmin(true);
  }

  function handleMasterLogout() {
    localStorage.removeItem(IS_MASTER_KEY);
    setIsMaster(false);
    setShowAdmin(false);
  }

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange(currentDate, viewMode);
      setEvents(await getEventsByDateRange(start, end));
      setSupabaseError(false);
    } catch {
      setSupabaseError(true);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [currentDate, viewMode]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  function navigate(dir: 1 | -1) {
    if (viewMode === "month") setCurrentDate((d) => dir === 1 ? addMonths(d, 1) : subMonths(d, 1));
    else if (viewMode === "week") setCurrentDate((d) => dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1));
    else setCurrentDate((d) => dir === 1 ? addDays(d, 1) : subDays(d, 1));
  }

  function getHeaderTitle() {
    if (viewMode === "month") return format(currentDate, "yyyy年M月", { locale: ja });
    if (viewMode === "week") {
      const s = startOfWeek(currentDate, { weekStartsOn: 0 });
      const e = endOfWeek(currentDate, { weekStartsOn: 0 });
      return `${format(s, "M/d")} 〜 ${format(e, "M/d")}`;
    }
    return format(currentDate, "M月d日(E)", { locale: ja });
  }

  function handleDayClick(date: Date) {
    if (viewMode === "month" || viewMode === "week") {
      setPreviousViewMode(viewMode);
      setCurrentDate(date);
      setViewMode("day");
    } else {
      setSelectedDate(date);
      setShowAddModal(true);
    }
  }

  function handleCloseDayView() {
    setViewMode(previousViewMode);
  }

  function handleEventClick(event: Event) {
    setSelectedEvent(event); setShowDetailModal(true);
  }

  function toggleFilterMember(name: string) {
    setFilterMembers((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  function toggleFilterGroup(id: string) {
    setFilterGroups((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

  function clearAllFilters() {
    setFilterMembers([]);
    setFilterGroups([]);
  }

  // グループフィルターが含むメンバー名の集合
  const groupFilterNames = new Set(
    groups
      .filter((g) => filterGroups.includes(g.id))
      .flatMap((g) => g.member_names)
  );

  // フィルター適用後のイベント
  const hasFilter = filterMembers.length > 0 || filterGroups.length > 0;
  const displayEvents = !hasFilter
    ? events
    : events.filter((e) =>
        e.assignees.some(
          (a) => filterMembers.includes(a) || groupFilterNames.has(a)
        )
      );

  async function handleSaveEvent(data: EventInsert) {
    if (editingEvent) {
      await updateEvent(editingEvent.id, data);
      logActivity(editingEvent.id, data.title, "updated", currentUser ?? "", editingEvent.assignees, data.assignees).catch(() => {});
    } else {
      const created = await createEvent(data);
      logActivity(created.id, data.title, "created", currentUser ?? "", [], data.assignees).catch(() => {});
    }
    setShowAddModal(false);
    setEditingEvent(null);
    setSelectedDate(null);
    setDuplicateData(null);
    await loadEvents();
  }

  async function handleDeleteEvent(event: Event) {
    await softDeleteEvent(event.id);
    logActivity(event.id, event.title, "deleted", currentUser ?? "", event.assignees, event.assignees).catch(() => {});
    setEvents((prev) => prev.filter((e) => e.id !== event.id));
    setShowDetailModal(false);
    setSelectedEvent(null);
  }

  function handleOpenActivityLog() {
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    setUnreadCount(0);
    setShowActivityLog(true);
  }

  async function handleActivityEventClick(eventId: string) {
    const event = await getEventById(eventId);
    if (!event) {
      alert("この予定は完全に削除されています");
      return;
    }
    if (event.deleted_at) {
      alert("この予定はゴミ箱に移されています");
      return;
    }
    setShowActivityLog(false);
    setSelectedEvent(event);
    setShowDetailModal(true);
  }

  function handleEditFromDetail() {
    setShowDetailModal(false);
    setEditingEvent(selectedEvent);
    setShowAddModal(true);
  }

  function handleDuplicateFromDetail() {
    if (!selectedEvent) return;
    setShowDetailModal(false);
    setSelectedEvent(null);
    setEditingEvent(null);
    setDuplicateData({
      title: selectedEvent.title,
      description: selectedEvent.description,
      start_date: selectedEvent.start_date,
      end_date: selectedEvent.end_date,
      start_time: selectedEvent.start_time,
      end_time: selectedEvent.end_time,
      all_day: selectedEvent.all_day,
      color: selectedEvent.color,
      image_url: selectedEvent.image_url,
      location: selectedEvent.location,
      assignees: selectedEvent.assignees,
      event_type: selectedEvent.event_type,
      created_by: currentUser,
      updated_by: currentUser,
    });
    setShowAddModal(true);
  }

  if (currentUser === null) return null;
  if (currentUser === "") return <UserNameModal onSave={handleUserNameSave} />;

  return (
    <div className="flex flex-col h-dvh max-h-dvh bg-[#f8f9fa]">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-0.5">
          <button onClick={() => setCurrentDate(new Date())}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors" title="今日へ">
            <Calendar size={20} className="text-indigo-500" />
          </button>
          <button onClick={() => navigate(-1)} className="hidden sm:flex p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <button onClick={() => navigate(1)} className="hidden sm:flex p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ChevronRight size={20} className="text-gray-600" />
          </button>
        </div>

        {/* 年月タイトル（タップでピッカー） */}
        <div className="relative">
          <button
            onClick={() => { setPickerYear(currentDate.getFullYear()); setShowDatePicker(!showDatePicker); }}
            className="flex items-center gap-1 text-base font-bold text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {getHeaderTitle()}
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          {showDatePicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
              <div className="fixed top-14 left-1/2 -translate-x-1/2 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 z-50 w-64">
                {/* 年選択 */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setPickerYear((y) => y - 1)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm font-bold text-gray-800">{pickerYear}年</span>
                  <button
                    onClick={() => setPickerYear((y) => y + 1)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                {/* 月選択 */}
                <div className="grid grid-cols-4 gap-1">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const isSelected =
                      pickerYear === currentDate.getFullYear() &&
                      m === currentDate.getMonth() + 1;
                    return (
                      <button
                        key={m}
                        onClick={() => {
                          setCurrentDate(new Date(pickerYear, m - 1, 1));
                          if (viewMode === "day") setViewMode("month");
                          setShowDatePicker(false);
                        }}
                        className={`py-2 text-sm rounded-xl font-medium transition-colors ${
                          isSelected
                            ? "bg-indigo-500 text-white"
                            : "hover:bg-indigo-50 text-gray-700"
                        }`}
                      >
                        {m}月
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {loading && <RefreshCw size={14} className="text-indigo-400 animate-spin mr-1" />}
          <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
            {(["month", "week", "day"] as ViewMode[]).map((mode) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${
                  viewMode === mode ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}>
                {mode === "month" ? "月" : mode === "week" ? "週" : "日"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSearch(true)}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors ml-0.5"
            title="検索"
          >
            <Search size={18} className="text-gray-400" />
          </button>
          <button
            onClick={handleOpenActivityLog}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors ml-0.5 relative"
            title="更新履歴"
          >
            <Bell size={18} className={unreadCount > 0 ? "text-indigo-500" : "text-gray-400"} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
          <button onClick={() => setShowTrash(true)}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors" title="ゴミ箱">
            <Trash2 size={18} className="text-gray-400" />
          </button>
          <button
            onClick={() => isMaster ? setShowAdmin(true) : setShowMasterPin(true)}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors" title="管理">
            <Settings size={18} className={isMaster ? "text-indigo-500" : "text-gray-400"} />
          </button>
        </div>
      </header>

      {/* 担当者・グループフィルターバー */}
      {members.length > 0 && (
        <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2 overflow-x-auto">
          {/* 全員 */}
          <button
            onClick={clearAllFilters}
            className={`shrink-0 w-8 h-8 rounded-full text-xs font-bold transition-colors ${
              !hasFilter ? "bg-indigo-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >全</button>

          {/* グループボタン */}
          {groups.map((g) => {
            const active = filterGroups.includes(g.id);
            return (
              <button
                key={g.id}
                onClick={() => toggleFilterGroup(g.id)}
                className={`shrink-0 px-3 h-8 rounded-full text-xs font-semibold transition-all border whitespace-nowrap ${
                  active
                    ? "bg-indigo-500 text-white border-indigo-500"
                    : "bg-white text-indigo-500 border-indigo-300 hover:bg-indigo-50"
                }`}
              >{g.name}</button>
            );
          })}

          {/* 区切り */}
          {groups.length > 0 && <div className="shrink-0 w-px h-5 bg-gray-200" />}

          {/* 個人アバター */}
          {members.map((m) => {
            const active = filterMembers.includes(m.name);
            return (
              <button
                key={m.id}
                onClick={() => toggleFilterMember(m.name)}
                className="shrink-0 w-8 h-8 rounded-full text-xs font-bold transition-all"
                style={{
                  backgroundColor: active ? m.color : m.color + "25",
                  color: active ? "white" : m.color,
                  outline: active ? `2px solid ${m.color}` : "none",
                  outlineOffset: "2px",
                }}
                title={m.name}
              >{m.name.charAt(0)}</button>
            );
          })}
        </div>
      )}

      {supabaseError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-700">
          ⚠️ 接続エラーが発生しました。ページを再読み込みしてください。
        </div>
      )}

      <main className="flex-1 overflow-hidden flex flex-col bg-white">
        {viewMode === "month" && <MonthView currentDate={currentDate} events={displayEvents} onDayClick={handleDayClick} onEventClick={handleEventClick} />}
        {viewMode === "week" && <WeekView currentDate={currentDate} events={displayEvents} onDayClick={handleDayClick} onEventClick={handleEventClick} />}
        {viewMode === "day" && <DayView currentDate={currentDate} events={displayEvents} onEventClick={handleEventClick} onClose={handleCloseDayView} />}
      </main>

      <button
        onClick={() => { setEditingEvent(null); setSelectedDate(currentDate); setShowAddModal(true); }}
        className="fixed bottom-6 right-5 w-14 h-14 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center active:scale-95"
        aria-label="予定を追加"
      >
        <Plus size={28} />
      </button>

      {showAddModal && (
        <EventModal
          event={editingEvent}
          initialData={duplicateData ?? undefined}
          defaultDate={selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined}
          currentUser={currentUser}
          onSave={handleSaveEvent}
          onDelete={editingEvent ? () => handleDeleteEvent(editingEvent) : undefined}
          onClose={() => { setShowAddModal(false); setEditingEvent(null); setDuplicateData(null); }}
        />
      )}

      {showDetailModal && selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          currentUser={currentUser}
          isMaster={isMaster}
          onEdit={handleEditFromDetail}
          onDuplicate={handleDuplicateFromDetail}
          onDelete={() => handleDeleteEvent(selectedEvent)}
          onClose={() => { setShowDetailModal(false); setSelectedEvent(null); }}
        />
      )}

      {showActivityLog && (
        <ActivityLogView
          currentUser={currentUser}
          onClose={() => setShowActivityLog(false)}
          onEventClick={handleActivityEventClick}
        />
      )}

      {showSearch && (
        <SearchView
          onEventClick={(event) => {
            setShowSearch(false);
            setSelectedEvent(event);
            setShowDetailModal(true);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {showTrash && (
        <TrashView
          isMaster={isMaster}
          onClose={() => setShowTrash(false)}
          onRestored={loadEvents}
        />
      )}

      {showAdmin && (
        <AdminPanel
          onClose={() => { setShowAdmin(false); getGroups().then(setGroups).catch(() => {}); }}
          onLogout={handleMasterLogout}
        />
      )}

      {showMasterPin && (
        <MasterPinModal
          onSuccess={handleMasterLoginSuccess}
          onClose={() => setShowMasterPin(false)}
        />
      )}
    </div>
  );
}

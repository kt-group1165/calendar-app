"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  format, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, isSameMonth, isToday,
} from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Calendar, RefreshCw, Trash2, Settings, Bell, Search, StickyNote, LogOut } from "lucide-react";
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
import MemoView from "@/components/MemoView";
import { type Event, type EventInsert } from "@/lib/supabase";
import {
  getEventsByDateRange, getEventById, createEvent, updateEvent,
  softDeleteEvent, cleanupOldDeletedEvents,
  logActivity, getUnreadActivityCount, getAllEvents,
} from "@/lib/events";
import { getMembers, type Member } from "@/lib/members";
import { getOffices, type Office } from "@/lib/offices";
import { getGroups, type MemberGroup } from "@/lib/groups";
import { getClientSelectionEnabled } from "@/lib/settings";
import { useCurrentUser, signOut } from "@/lib/auth";

const LAST_SEEN_KEY = (tid: string) => `calendar_activity_last_seen_${tid}`;
const LAST_BACKUP_KEY = (tid: string) => `calendar_last_backup_date_${tid}`;
const USER_NAME_KEY = (tid: string) => `calendar_user_name_${tid}`;
const IS_MASTER_KEY = (tid: string) => `calendar_is_master_${tid}`;

type ViewMode = "month" | "week" | "day";

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

export default function TenantCalendarPage() {
  const params = useParams<{ tenant: string }>();
  const tenantId = params.tenant as string;
  const searchParams = useSearchParams();
  const currentOfficeId = searchParams.get("office"); // nullなら全事業所表示

  // Auth セッションがある場合はそれを優先（PIN モード互換ロジックは下で維持）
  const authUser = useCurrentUser(tenantId);

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
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth());

  // 担当者フィルター
  const [members, setMembers] = useState<Member[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  const currentOffice = useMemo(
    () => offices.find((o) => o.id === currentOfficeId) ?? null,
    [offices, currentOfficeId]
  );
  const [filterMembers, setFilterMembers] = useState<string[]>([]);
  const [filterGroups, setFilterGroups] = useState<string[]>([]);

  const [clientSelectionEnabled, setClientSelectionEnabled] = useState(true);

  // 活動ログ・通知
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Auth セッションが確定したら、そちらから currentUser / isMaster を同期
  useEffect(() => {
    if (!tenantId || authUser.loading) return;
    if (authUser.authUser) {
      // Auth モード：user_tenants から取得した情報を使用
      setCurrentUser(authUser.name ?? authUser.authUser.email ?? "");
      setIsMaster(authUser.role === "master");
    }
    // 未ログイン時は下の localStorage 読み取り useEffect にまかせる
  }, [authUser.loading, authUser.authUser, authUser.name, authUser.role, tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    // 認証状態が確定するまで待つ（localStorage 読み取りのフラッシュを防ぐ）
    if (authUser.loading) return;

    // Auth 済み → localStorage の PIN 情報は無視
    if (!authUser.authUser) {
      // PIN モード（匿名）：従来通り localStorage から
      const name = localStorage.getItem(USER_NAME_KEY(tenantId));
      const master = localStorage.getItem(IS_MASTER_KEY(tenantId)) === "true";
      setCurrentUser(name ?? "");
      if (master) setIsMaster(true);
    }
    cleanupOldDeletedEvents(tenantId).catch(() => {});
    getMembers(tenantId).then(setMembers).catch(() => {});
    getOffices(tenantId).then(setOffices).catch(() => {});
    getGroups(tenantId).then(setGroups).catch(() => {});
    getClientSelectionEnabled(tenantId).then(setClientSelectionEnabled).catch(() => {});

    // 1日1回、アプリを開いたときに自動バックアップCSVをダウンロード
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastBackup = localStorage.getItem(LAST_BACKUP_KEY(tenantId));
    if (lastBackup !== todayStr) {
      getAllEvents(tenantId).then((evts) => {
        const CSV_HEADERS = ["ID","タイトル","開始日","終了日","開始時刻","終了時刻","終日","用件種別","担当者","メモ","備考","住所","カラー","作成者","最終編集者","作成日時"];
        const rows = evts.map((e) => [
          e.id, e.title, e.start_date, e.end_date,
          e.start_time?.slice(0,5) ?? "", e.end_time?.slice(0,5) ?? "",
          e.all_day ? "はい" : "いいえ",
          (e.event_type ?? []).join("・"), (e.assignees ?? []).join("・"),
          e.description ?? "", e.notes ?? "", e.location ?? "",
          e.color ?? "#6366f1",
          e.created_by ?? "", e.updated_by ?? "",
          new Date(e.created_at).toLocaleString("ja-JP"),
        ]);
        const csv = "\uFEFF" + [CSV_HEADERS, ...rows]
          .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g,'""')}"`).join(","))
          .join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `backup_${tenantId}_${todayStr}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        localStorage.setItem(LAST_BACKUP_KEY(tenantId), todayStr);
      }).catch(() => {});
    }

    // 未読件数を取得
    const lastSeen = localStorage.getItem(LAST_SEEN_KEY(tenantId));
    if (!lastSeen) {
      localStorage.setItem(LAST_SEEN_KEY(tenantId), new Date().toISOString());
    } else {
      getUnreadActivityCount(lastSeen, tenantId).then(setUnreadCount).catch(() => {});
    }
  }, [tenantId, authUser.loading, authUser.authUser]);

  function handleUserNameSave(name: string, master: boolean) {
    localStorage.setItem(USER_NAME_KEY(tenantId), name);
    if (master) {
      localStorage.setItem(IS_MASTER_KEY(tenantId), "true");
      setIsMaster(true);
    }
    setCurrentUser(name);
  }

  function handleMasterLoginSuccess() {
    localStorage.setItem(IS_MASTER_KEY(tenantId), "true");
    setIsMaster(true);
    setShowMasterPin(false);
    setShowAdmin(true);
  }

  function handleMasterLogout() {
    localStorage.removeItem(IS_MASTER_KEY(tenantId));
    setIsMaster(false);
    setShowAdmin(false);
  }

  const loadEvents = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { start, end } = getDateRange(currentDate, viewMode);
      setEvents(await getEventsByDateRange(start, end, tenantId));
      setSupabaseError(false);
    } catch {
      setSupabaseError(true);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [currentDate, viewMode, tenantId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  function navigate(dir: 1 | -1) {
    if (viewMode === "month") setCurrentDate((d) => dir === 1 ? addMonths(d, 1) : subMonths(d, 1));
    else if (viewMode === "week") setCurrentDate((d) => dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1));
    else setCurrentDate((d) => dir === 1 ? addDays(d, 1) : subDays(d, 1));
  }

  function getHeaderTitle() {
    if (viewMode === "month") return format(currentDate, "yyyy年M月", { locale: ja });
    if (viewMode === "week") return format(currentDate, "yyyy年M月", { locale: ja });
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

  const groupFilterNames = new Set(
    groups
      .filter((g) => filterGroups.includes(g.id))
      .flatMap((g) => g.member_names)
  );

  // 事業所フィルター（URL ?office=<id>）
  const officeFilteredMembers = useMemo(() => {
    if (!currentOfficeId) return members;
    return members.filter((m) => m.office_id === currentOfficeId);
  }, [members, currentOfficeId]);
  const officeMemberNames = useMemo(
    () => new Set(officeFilteredMembers.map((m) => m.name)),
    [officeFilteredMembers]
  );

  const officeFilteredEvents = useMemo(() => {
    if (!currentOfficeId) return events;
    return events.filter(
      (e) =>
        e.office_id === currentOfficeId ||
        // 後方互換：office_id未設定でも、担当者がこの事業所ならこの事業所扱い
        (e.office_id == null && e.assignees.some((a) => officeMemberNames.has(a)))
    );
  }, [events, currentOfficeId, officeMemberNames]);

  const hasFilter = filterMembers.length > 0 || filterGroups.length > 0;
  const displayEvents = !hasFilter
    ? officeFilteredEvents
    : officeFilteredEvents.filter((e) =>
        e.assignees.some(
          (a) => filterMembers.includes(a) || groupFilterNames.has(a)
        )
      );

  async function handleSaveEvent(data: EventInsert) {
    // 事業所切替中に作成された予定は、その事業所に紐付ける
    // さもなくば担当者のoffice_idから自動推定
    const inferOfficeId = () => {
      if (data.office_id) return data.office_id;
      if (currentOfficeId) return currentOfficeId;
      for (const assigneeName of data.assignees) {
        const m = members.find((mm) => mm.name === assigneeName);
        if (m?.office_id) return m.office_id;
      }
      return null;
    };
    const enriched: EventInsert = { ...data, office_id: inferOfficeId() };
    if (editingEvent) {
      await updateEvent(editingEvent.id, enriched);
      logActivity(editingEvent.id, enriched.title, "updated", currentUser ?? "", editingEvent.assignees, enriched.assignees, tenantId).catch(() => {});
    } else {
      const created = await createEvent(enriched, tenantId);
      logActivity(created.id, enriched.title, "created", currentUser ?? "", [], enriched.assignees, tenantId).catch(() => {});
    }
    setShowAddModal(false);
    setEditingEvent(null);
    setSelectedDate(null);
    setDuplicateData(null);
    await loadEvents();
  }

  async function handleDeleteEvent(event: Event) {
    await softDeleteEvent(event.id);
    logActivity(event.id, event.title, "deleted", currentUser ?? "", event.assignees, event.assignees, tenantId).catch(() => {});
    setEvents((prev) => prev.filter((e) => e.id !== event.id));
    setShowDetailModal(false);
    setSelectedEvent(null);
  }

  function handleOpenActivityLog() {
    localStorage.setItem(LAST_SEEN_KEY(tenantId), new Date().toISOString());
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
      is_memo: false,
      color: selectedEvent.color,
      image_url: selectedEvent.image_url,
      image_urls: selectedEvent.image_urls ?? [],
      location: selectedEvent.location,
      notes: selectedEvent.notes,
      assignees: selectedEvent.assignees,
      event_type: selectedEvent.event_type,
      created_by: currentUser,
      updated_by: currentUser,
    });
    setShowAddModal(true);
  }

  // 認証状態が確定するまでは何も描画しない（localStorage フラッシュ防止）
  if (authUser.loading) return null;
  if (currentUser === null) return null;
  // Auth 未使用かつ名前未登録 → UserNameModal で従来の PIN フローへ
  if (!authUser.authUser && currentUser === "") {
    return <UserNameModal tenantId={tenantId} officeId={currentOfficeId} onSave={handleUserNameSave} />;
  }

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
        <div className="relative flex flex-col items-center">
          <button
            onClick={() => { setPickerYear(currentDate.getFullYear()); setPickerMonth(currentDate.getMonth()); setShowDatePicker(!showDatePicker); }}
            className="flex items-center gap-1 text-base font-bold text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {getHeaderTitle()}
            <ChevronDown size={14} className="text-gray-400" />
          </button>
          {currentOffice && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium leading-none -mt-0.5 truncate max-w-[200px]">
              {currentOffice.name}
            </span>
          )}

          {showDatePicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
              <div className={`fixed top-14 left-1/2 -translate-x-1/2 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 z-50 ${viewMode === "day" ? "w-72" : "w-64"}`}>

                {viewMode === "month" ? (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <button onClick={() => setPickerYear((y) => y - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ChevronLeft size={16} /></button>
                      <span className="text-sm font-bold text-gray-800">{pickerYear}年</span>
                      <button onClick={() => setPickerYear((y) => y + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ChevronRight size={16} /></button>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                        const sel = pickerYear === currentDate.getFullYear() && m === currentDate.getMonth() + 1;
                        return (
                          <button key={m} onClick={() => { setCurrentDate(new Date(pickerYear, m - 1, 1)); setShowDatePicker(false); }}
                            className={`py-2 text-sm rounded-xl font-medium transition-colors ${sel ? "bg-indigo-500 text-white" : "hover:bg-indigo-50 text-gray-700"}`}>
                            {m}月
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <button
                        onClick={() => { const d = new Date(pickerYear, pickerMonth - 1, 1); setPickerYear(d.getFullYear()); setPickerMonth(d.getMonth()); }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                      ><ChevronLeft size={16} /></button>
                      <span className="text-sm font-bold text-gray-800">{pickerYear}年{pickerMonth + 1}月</span>
                      <button
                        onClick={() => { const d = new Date(pickerYear, pickerMonth + 1, 1); setPickerYear(d.getFullYear()); setPickerMonth(d.getMonth()); }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                      ><ChevronRight size={16} /></button>
                    </div>

                    {viewMode === "day" ? (
                      <>
                        <div className="grid grid-cols-7 mb-1">
                          {["日","月","火","水","木","金","土"].map((d, i) => (
                            <div key={i} className={`text-center text-[10px] font-medium py-0.5 ${i===0?"text-red-400":i===6?"text-blue-400":"text-gray-400"}`}>{d}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-y-0.5">
                          {(() => {
                            const mStart = startOfMonth(new Date(pickerYear, pickerMonth));
                            const calStart = startOfWeek(mStart, { weekStartsOn: 0 });
                            return Array.from({ length: 42 }, (_, i) => addDays(calStart, i)).map((d, i) => {
                              const inMonth = isSameMonth(d, mStart);
                              const sel = isSameDay(d, currentDate);
                              const tod = isToday(d);
                              return (
                                <button key={i} onClick={() => { setCurrentDate(d); setShowDatePicker(false); }}
                                  className={`w-8 h-8 mx-auto text-xs rounded-full flex items-center justify-center font-medium transition-colors
                                    ${sel ? "bg-indigo-500 text-white" : tod ? "bg-indigo-100 text-indigo-600" : !inMonth ? "text-gray-300" : "text-gray-700 hover:bg-gray-100"}`}>
                                  {format(d, "d")}
                                </button>
                              );
                            });
                          })()}
                        </div>
                      </>
                    ) : (
                      <div className="space-y-1">
                        {(() => {
                          const mStart = startOfMonth(new Date(pickerYear, pickerMonth));
                          const mEnd = endOfMonth(new Date(pickerYear, pickerMonth));
                          const weeks: Date[] = [];
                          let w = startOfWeek(mStart, { weekStartsOn: 0 });
                          while (w <= mEnd) { weeks.push(w); w = addDays(w, 7); }
                          const curWeekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
                          return weeks.map((wk, i) => {
                            const sel = isSameDay(wk, curWeekStart);
                            return (
                              <button key={i} onClick={() => { setCurrentDate(wk); setShowDatePicker(false); }}
                                className={`w-full text-left px-3 py-2 text-sm rounded-xl transition-colors ${sel ? "bg-indigo-500 text-white" : "hover:bg-gray-100 text-gray-700"}`}>
                                {format(wk, "M/d(E)", { locale: ja })} 〜 {format(addDays(wk, 6), "M/d(E)", { locale: ja })}
                              </button>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </>
                )}
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
            onClick={() => setShowMemo(true)}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors ml-0.5"
            title="メモ（日付未定）"
          >
            <StickyNote size={18} className="text-gray-400" />
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
          {authUser.authUser && (
            <button
              onClick={async () => {
                if (!confirm("ログアウトしますか？")) return;
                await signOut();
                window.location.href = "/";
              }}
              className="p-2 rounded-xl hover:bg-red-50 transition-colors"
              title={`ログアウト (${authUser.authUser.email})`}
            >
              <LogOut size={18} className="text-gray-400" />
            </button>
          )}
        </div>
      </header>

      {/* 担当者・グループフィルターバー */}
      {officeFilteredMembers.length > 0 && (
        <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2 overflow-x-auto">
          <button
            onClick={clearAllFilters}
            className={`shrink-0 w-8 h-8 rounded-full text-xs font-bold transition-colors ${
              !hasFilter ? "bg-indigo-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >全</button>

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

          {groups.length > 0 && <div className="shrink-0 w-px h-5 bg-gray-200" />}

          {officeFilteredMembers.map((m) => {
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
        {viewMode === "day" && <DayView currentDate={currentDate} events={displayEvents} onEventClick={handleEventClick} onClose={handleCloseDayView} onDateHeaderClick={() => { setPickerYear(currentDate.getFullYear()); setPickerMonth(currentDate.getMonth()); setShowDatePicker(true); }} />}
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
          tenantId={tenantId}
          event={editingEvent}
          initialData={duplicateData ?? undefined}
          defaultDate={selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined}
          currentUser={currentUser}
          clientSelectionEnabled={clientSelectionEnabled}
          onSave={handleSaveEvent}
          onDelete={editingEvent ? () => handleDeleteEvent(editingEvent) : undefined}
          onClose={() => { setShowAddModal(false); setEditingEvent(null); setDuplicateData(null); }}
        />
      )}

      {showDetailModal && selectedEvent && (
        <EventDetailModal
          tenantId={tenantId}
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
          tenantId={tenantId}
          currentUser={currentUser}
          onClose={() => setShowActivityLog(false)}
          onEventClick={handleActivityEventClick}
        />
      )}

      {showSearch && (
        <SearchView
          tenantId={tenantId}
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
          tenantId={tenantId}
          isMaster={isMaster}
          onClose={() => setShowTrash(false)}
          onRestored={loadEvents}
        />
      )}

      {showAdmin && (
        <AdminPanel
          tenantId={tenantId}
          onClose={() => { setShowAdmin(false); getGroups(tenantId).then(setGroups).catch(() => {}); }}
          onLogout={handleMasterLogout}
        />
      )}

      {showMasterPin && (
        <MasterPinModal
          tenantId={tenantId}
          onSuccess={handleMasterLoginSuccess}
          onClose={() => setShowMasterPin(false)}
        />
      )}

      {showMemo && (
        <MemoView
          tenantId={tenantId}
          onEventClick={(memo) => {
            setShowMemo(false);
            setEditingEvent(memo);
            setShowAddModal(true);
          }}
          onClose={() => setShowMemo(false)}
        />
      )}
    </div>
  );
}

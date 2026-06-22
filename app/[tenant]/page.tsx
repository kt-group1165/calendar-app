"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
  format, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, isSameMonth, isToday,
} from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Calendar, RefreshCw, Trash2, Settings, Bell, Search, StickyNote, LogOut, Fingerprint, MoreVertical, BarChart3 } from "lucide-react";
import MonthView from "@/components/MonthView";
import WeekView from "@/components/WeekView";
import DayView from "@/components/DayView";
import EventModal from "@/components/EventModal";
import EventDetailModal from "@/components/EventDetailModal";
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
import { getEventAreas, type EventArea } from "@/lib/event_areas";
import { getEventTypes, type EventType } from "@/lib/event_types";
import { getClientSelectionEnabled } from "@/lib/settings";
import { useCurrentUser, signOut } from "@/lib/auth";
import { getUserScope, type UserScope } from "@/lib/user_scope";

const LAST_SEEN_KEY = (tid: string) => `calendar_activity_last_seen_${tid}`;
const LAST_BACKUP_KEY = (tid: string) => `calendar_last_backup_date_${tid}`;
// 用件種別フィルタ機能のON/OFF（個人設定・端末ごと）
const EVENT_TYPE_FILTER_ENABLED_KEY = (tid: string) => `calendar_event_type_filter_enabled_${tid}`;

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

// === 福祉用具管理者 デモ tenant ===
// URL `/fukuyogu-kanri-demo` は実 tenant が無いエイリアス。本物の `fukuyogu-kanri`
// と同じ DB lookup を行い、events だけは is_demo=true も合わせて表示する。
// プレゼン用に「目標頻度を達成している見た目」を出すための水増し event は
// scripts/seed_demo_events_to_target.mjs で生成 → is_demo=true で記録される。
const DEMO_TENANT_ID = "fukuyogu-kanri-demo";
const DEMO_ALIAS_REAL_TENANT_ID = "fukuyogu-kanri";

export default function TenantCalendarPage() {
  const params = useParams<{ tenant: string }>();
  const urlTenantId = params.tenant as string;
  // 実 DB lookup には real tenant id を使う。URL/router 用には urlTenantId を維持。
  const isDemoTenant = urlTenantId === DEMO_TENANT_ID;
  const tenantId = isDemoTenant ? DEMO_ALIAS_REAL_TENANT_ID : urlTenantId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentOfficeId = searchParams.get("office"); // nullなら全事業所表示

  const authUser = useCurrentUser(tenantId);

  // 自 office 自動絞り込み：office_admin / member（user_offices 行を持つユーザ）が
  // ?office= 無しで /[tenant] に来たら、自分の primary office を URL に乗せる。
  // group_admin / company_admin は user_offices 行を持たず primaryOfficeId が
  // null になるので、この redirect の対象外（tenant-wide view のまま）。
  // 1 セッション 1 回だけ実行（リダイレクト後ユーザが手動で「全事業所」に戻した
  // 場合に毎回戻されないように）。
  const autoOfficeRedirectDoneRef = useRef(false);
  useEffect(() => {
    if (autoOfficeRedirectDoneRef.current) return;
    if (authUser.loading) return;
    if (!authUser.authUser) return;
    if (currentOfficeId) {
      autoOfficeRedirectDoneRef.current = true;
      return;
    }
    if (authUser.primaryOfficeId) {
      autoOfficeRedirectDoneRef.current = true;
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set("office", authUser.primaryOfficeId);
      router.replace(`/${urlTenantId}?${params.toString()}`);
    }
  }, [authUser.loading, authUser.authUser, authUser.primaryOfficeId, currentOfficeId, router, searchParams, urlTenantId]);

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
  const [duplicateData, setDuplicateData] = useState<EventInsert | null>(null);

  // 年月ピッカー
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth());

  // 担当者フィルター
  const [members, setMembers] = useState<Member[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  // ヘッダー下に表示する office 名:
  //   1. currentOfficeId 指定があればその office
  //   2. role tenant (kt-group 以外) で office が 1 件のみなら、その office を表示
  //      (例: /fukuyogu-kanri は 福祉用具管理者 office 1 つしかないので自動表示)
  const currentOffice = useMemo(() => {
    const found = offices.find((o) => o.id === currentOfficeId);
    if (found) return found;
    if (tenantId !== "kt-group" && !currentOfficeId && offices.length === 1) {
      return offices[0];
    }
    return null;
  }, [offices, currentOfficeId, tenantId]);
  // 閲覧スコープ (group_admin = 全件、office_admin = 自 offices + 本社、member = 自 offices のみ)
  const [userScope, setUserScope] = useState<UserScope | null>(null);
  useEffect(() => {
    if (authUser.loading || !authUser.authUser) return;
    let cancelled = false;
    getUserScope().then((s) => { if (!cancelled) setUserScope(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [authUser.loading, authUser.authUser]);

  const [filterMembers, setFilterMembers] = useState<string[]>([]);
  const [filterGroups, setFilterGroups] = useState<string[]>([]);
  const [filterAreas, setFilterAreas] = useState<string[]>([]);
  const [filterEventTypes, setFilterEventTypes] = useState<string[]>([]);
  const [eventAreas, setEventAreas] = useState<EventArea[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  // 用件種別フィルタ機能のON/OFF（個人設定）：master=ON、それ以外=OFFがデフォルト
  const [eventTypeFilterEnabled, setEventTypeFilterEnabledState] = useState(false);

  const [clientSelectionEnabled, setClientSelectionEnabled] = useState(true);

  // 活動ログ・通知
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ヘッダー右端「その他」メニュー (mobile で icon が溢れないよう集約)
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Auth セッションから currentUser / isMaster を derive。
  // 未ログイン時は proxy で /login へ redirect されているはず。
  useEffect(() => {
    if (!tenantId || authUser.loading) return;
    if (authUser.authUser) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- HANDOVER §2 (mount-time async fetch / mount init)
      setCurrentUser(authUser.name ?? authUser.authUser.email ?? "");
      setIsMaster(authUser.role === "master");
    }
  }, [authUser.loading, authUser.authUser, authUser.name, authUser.role, tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    if (authUser.loading) return;
    // currentOfficeId が null = group_admin の tenant-wide view、null 以外 = office 絞込
    const office = currentOfficeId ?? undefined;
    cleanupOldDeletedEvents(office).catch((e: unknown) => console.warn("[page] cleanupOldDeletedEvents failed:", e));
    getMembers(tenantId, office).then(setMembers).catch((e: unknown) => console.warn("[page] getMembers failed:", e));
    getOffices(tenantId).then(setOffices).catch((e: unknown) => console.warn("[page] getOffices failed:", e));
    getGroups(tenantId).then(setGroups).catch((e: unknown) => console.warn("[page] getGroups failed:", e));
    getEventAreas(tenantId, office).then(setEventAreas).catch((e: unknown) => console.warn("[page] getEventAreas failed:", e));
    getEventTypes(tenantId, { officeId: office }).then(setEventTypes).catch((e: unknown) => console.warn("[page] getEventTypes failed:", e));
    getClientSelectionEnabled(tenantId).then(setClientSelectionEnabled).catch((e: unknown) => console.warn("[page] getClientSelectionEnabled failed:", e));

    // 1日1回、アプリを開いたときに自動バックアップCSVをダウンロード
    // バックアップは tenant 全件 (officeId 渡さない) で従来どおり
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastBackup = localStorage.getItem(LAST_BACKUP_KEY(tenantId));
    if (lastBackup !== todayStr) {
      getAllEvents().then((evts) => {
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
      }).catch((e: unknown) => console.warn("[page] CSV backup failed:", e));
    }

    // 未読件数を取得
    const lastSeen = localStorage.getItem(LAST_SEEN_KEY(tenantId));
    if (!lastSeen) {
      localStorage.setItem(LAST_SEEN_KEY(tenantId), new Date().toISOString());
    } else {
      getUnreadActivityCount(lastSeen, tenantId).then(setUnreadCount).catch((e: unknown) => console.warn("[page] getUnreadActivityCount failed:", e));
    }
  }, [tenantId, authUser.loading, authUser.authUser, currentOfficeId]);

  // tenant scope の office ids を memoize (kt-group は null = no filter)
  // offices array reference が変わるたびに再計算するが、loadEvents の deps を安定化
  const tenantOfficeIds = useMemo<string[] | null>(() => {
    if (tenantId === "kt-group") return null;
    return offices.map((o) => o.id);
  }, [tenantId, offices]);

  // user scope ∩ tenant scope の交差を memoize
  // currentOfficeId 指定時は undefined (single-office mode)
  const effectiveOfficeIds = useMemo<string[] | undefined | "empty">(() => {
    if (!userScope) return undefined;
    if (currentOfficeId) return undefined; // single-office mode
    if (userScope.kind === "group_admin") {
      return tenantOfficeIds ?? undefined;
    }
    // office_admin / member: user scope と tenant scope の交差
    let allowed = userScope.allowedOfficeIds;
    if (tenantOfficeIds !== null) {
      const tenantSet = new Set(tenantOfficeIds);
      allowed = allowed.filter((id) => tenantSet.has(id));
    }
    if (allowed.length === 0) return "empty";
    return allowed;
  }, [userScope, currentOfficeId, tenantOfficeIds]);

  const loadEvents = useCallback(async () => {
    if (!tenantId) return;
    // スコープ未確定の間は fetch を保留 (一瞬でも 全件 leak しないため)
    if (!userScope) return;
    // role tenant (kt-group 以外) では offices をロードしてからでないと
    // 「その tenant の events だけ」に絞れないので保留する
    if (tenantId !== "kt-group" && !currentOfficeId && offices.length === 0) {
      return;
    }
    if (effectiveOfficeIds === "empty") {
      setEvents([]);
      setSupabaseError(false);
      return;
    }
    setLoading(true);
    try {
      const { start, end } = getDateRange(currentDate, viewMode);
      setEvents(await getEventsByDateRange(start, end, currentOfficeId ?? undefined, effectiveOfficeIds, isDemoTenant));
      setSupabaseError(false);
    } catch (e: unknown) {
      console.warn("[page] getEventsByDateRange failed:", e);
      setSupabaseError(true);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [currentDate, viewMode, tenantId, currentOfficeId, userScope, offices, effectiveOfficeIds, isDemoTenant]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- HANDOVER §2 (mount-time async fetch / mount init)
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

  function toggleFilterArea(id: string) {
    setFilterAreas((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  function toggleFilterEventType(name: string) {
    setFilterEventTypes((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  function clearAllFilters() {
    setFilterMembers([]);
    setFilterGroups([]);
    setFilterAreas([]);
    setFilterEventTypes([]);
  }

  // 用件種別フィルタ機能のON/OFF（個人設定）読み込み
  // 既定値: master=ON、それ以外=OFF
  useEffect(() => {
    if (!tenantId) return;
    if (authUser.loading) return;
    const stored = typeof window !== "undefined"
      ? localStorage.getItem(EVENT_TYPE_FILTER_ENABLED_KEY(tenantId))
      : null;
    if (stored !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- HANDOVER §2 (mount-time async fetch / mount init)
      setEventTypeFilterEnabledState(stored === "true");
    } else {
      setEventTypeFilterEnabledState(isMaster);
    }
  }, [tenantId, isMaster, authUser.loading]);

  // ON/OFFをlocalStorageに保存
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional placeholder / future use
  function setEventTypeFilterEnabled(val: boolean) {
    setEventTypeFilterEnabledState(val);
    if (!val) setFilterEventTypes([]); // OFF時は選択解除
    if (typeof window !== "undefined") {
      localStorage.setItem(EVENT_TYPE_FILTER_ENABLED_KEY(tenantId), val ? "true" : "false");
    }
  }

  const groupFilterNames = new Set(
    groups
      .filter((g) => filterGroups.includes(g.id))
      .flatMap((g) => g.member_names)
  );

  // 事業所フィルター（URL ?office=<id>）
  const officeFilteredMembers = useMemo(() => {
    if (!currentOfficeId) return members;
    return members.filter((m) => m.office_ids.includes(currentOfficeId));
  }, [members, currentOfficeId]);
  const officeMemberNames = useMemo(
    () => new Set(officeFilteredMembers.map((m) => m.name)),
    [officeFilteredMembers]
  );

  const officeFilteredEvents = useMemo(() => {
    if (!currentOfficeId) return events;
    return events.filter(
      (e) =>
        // Phase 9-5: scope_office_ids に currentOfficeId を含めば表示
        // (兼務 staff の event が全所属 office で見える)
        (e.scope_office_ids ?? []).includes(currentOfficeId) ||
        // 後方互換：scope 未設定 / office_id 一致
        e.office_id === currentOfficeId ||
        // 旧データ用: office_id未設定でも、担当者がこの事業所ならこの事業所扱い
        (e.office_id == null && e.assignees.some((a) => officeMemberNames.has(a)))
    );
  }, [events, currentOfficeId, officeMemberNames]);

  const hasFilter = filterMembers.length > 0 || filterGroups.length > 0 || filterAreas.length > 0 || filterEventTypes.length > 0;
  const filteredEvents = !hasFilter
    ? officeFilteredEvents
    : officeFilteredEvents.filter((e) => {
        // メンバー/グループで絞り込み
        const memberMatch = filterMembers.length === 0 && filterGroups.length === 0
          ? true
          : e.assignees.some((a) => filterMembers.includes(a) || groupFilterNames.has(a));
        // エリアで絞り込み
        const areaMatch = filterAreas.length === 0
          ? true
          : (e.area_id != null && filterAreas.includes(e.area_id));
        // 用件種別で絞り込み
        const typeMatch = filterEventTypes.length === 0
          ? true
          : (e.event_type ?? []).some((t) => filterEventTypes.includes(t));
        return memberMatch && areaMatch && typeMatch;
      });

  // Phase 9-5 タイトルマスク:
  //   本社以外の事業所カレンダーで他事業所オリジンの event を表示する際、
  //   タイトルを「{元事業所名}案件」にマスクして利用者氏名を隠す (privacy)
  //   - currentOffice.service_type === '本社' の場合は実タイトルを表示
  //   - event.office_id === currentOfficeId の場合 (= 自事業所オリジン) も実タイトル
  const displayEvents = useMemo(() => {
    if (!currentOffice || currentOffice.service_type === "本社") return filteredEvents;
    const officeById = new Map(offices.map((o) => [o.id, o] as const));
    return filteredEvents.map((e) => {
      if (e.office_id && e.office_id !== currentOffice.id) {
        const origin = officeById.get(e.office_id);
        // short_name があれば優先 (例: 「ケアサポ案件」)、なければ full name
        const displayName = origin?.short_name ?? origin?.name ?? "他事業所";
        return { ...e, title: `${displayName}案件` };
      }
      return e;
    });
  }, [filteredEvents, currentOffice, offices]);

  async function handleSaveEvent(data: EventInsert) {
    // 事業所切替中に作成された予定は、その事業所に紐付ける
    // さもなくば担当者のoffice_idから自動推定
    //
    // Phase 9-5f-fix: /fukuyogu-kanri のように role-tenant で URL に ?office= が
    //   無いケースでも、currentOffice (= 自動解決された tenant の唯一の office) を
    //   優先する。これを assignee 推定より先にしないと「管理者カレンダーで作った
    //   つもりが、assignee の primary office (例: 花見川) が origin になる」事故
    //   が起こる。
    const inferOfficeId = () => {
      if (data.office_id) return data.office_id;
      if (currentOfficeId) return currentOfficeId;
      if (currentOffice) return currentOffice.id;
      for (const assigneeName of data.assignees) {
        const m = members.find((mm) => mm.name === assigneeName);
        if (m?.primary_office_id) return m.primary_office_id;
      }
      return null;
    };
    const resolvedOfficeId = inferOfficeId();
    // area_id を予定の事業所に合ったものに振り替える
    //   例: A事業所の市原(id=X)を選択したまま、予定の事業所がB事業所になる場合
    //   → B事業所の市原(id=Y)に自動変換
    let resolvedAreaId = data.area_id ?? null;
    if (resolvedAreaId && resolvedOfficeId) {
      const selectedArea = eventAreas.find((a) => a.id === resolvedAreaId);
      if (selectedArea && selectedArea.office_id !== resolvedOfficeId) {
        const matching = eventAreas.find(
          (a) => a.office_id === resolvedOfficeId && a.name === selectedArea.name,
        );
        if (matching) resolvedAreaId = matching.id;
      }
    }
    const enriched: EventInsert = {
      ...data,
      office_id: resolvedOfficeId,
      area_id: resolvedAreaId,
    };
    if (editingEvent) {
      await updateEvent(editingEvent.id, enriched);
      logActivity(editingEvent.id, enriched.title, "updated", currentUser ?? "", editingEvent.assignees, enriched.assignees, tenantId).catch(() => {});
    } else {
      const created = await createEvent(enriched);
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
      visit_other_detail: selectedEvent.visit_other_detail,
      created_by: currentUser,
      updated_by: currentUser,
    });
    setShowAddModal(true);
  }

  // 認証状態が確定するまでは何も描画しない
  if (authUser.loading) return null;
  if (currentUser === null) return null;

  return (
    <div className="flex flex-col h-dvh max-h-dvh bg-[#f8f9fa]">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-100 px-2 py-2 flex items-center justify-between gap-1 shadow-sm">
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => setCurrentDate(new Date())}
            className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 transition-colors" title="今日へ">
            <Calendar size={18} className="text-indigo-500 sm:size-5" />
          </button>
          <button onClick={() => navigate(-1)} className="hidden sm:flex p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <button onClick={() => navigate(1)} className="hidden sm:flex p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ChevronRight size={20} className="text-gray-600" />
          </button>
        </div>

        {/* 年月タイトル（タップでピッカー） */}
        <div className="relative flex flex-col items-center min-w-0 flex-1">
          <button
            onClick={() => { setPickerYear(currentDate.getFullYear()); setPickerMonth(currentDate.getMonth()); setShowDatePicker(!showDatePicker); }}
            className="flex items-center gap-1 text-sm sm:text-base font-bold text-gray-800 px-2 py-0.5 rounded-lg hover:bg-gray-100 transition-colors whitespace-nowrap"
          >
            {getHeaderTitle()}
            <ChevronDown size={14} className="text-gray-400 shrink-0" />
          </button>
          {currentOffice && (
            <button
              onClick={() => router.push("/")}
              className="text-xs sm:text-sm px-2.5 py-1 mt-0.5 rounded-full bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-indigo-700 font-semibold leading-none inline-flex items-center gap-1 transition-colors whitespace-nowrap max-w-full"
              title={`事業所選択に戻る (${currentOffice.name})`}
            >
              <span className="truncate">
                {(() => {
                  // short_name 優先 (= 「ケアサポ」「誉田」等の短縮表示)、なければ name (最大 14 字でトリム)
                  const label = currentOffice.short_name ?? currentOffice.name;
                  return label.length > 14 ? `${label.slice(0, 14)}…` : label;
                })()}
              </span>
              <ChevronDown size={12} className="rotate-90 -mr-0.5 shrink-0" />
            </button>
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

        <div className="flex items-center gap-0 shrink-0">
          {loading && <RefreshCw size={14} className="text-indigo-400 animate-spin mr-1" />}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5 mr-0.5">
            {(["month", "week", "day"] as ViewMode[]).map((mode) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`text-[11px] sm:text-xs px-1.5 py-0.5 rounded-md font-medium transition-colors ${
                  viewMode === mode ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}>
                {mode === "month" ? "月" : mode === "week" ? "週" : "日"}
              </button>
            ))}
          </div>
          {tenantId === "fukuyogu-kanri" && (
            <button
              onClick={() => router.push(`/${urlTenantId}/visit-analytics`)}
              className="p-1.5 sm:p-2 rounded-xl hover:bg-indigo-50 transition-colors"
              title="訪問分析"
            >
              <BarChart3 size={16} className="text-indigo-500 sm:size-[18px]" />
            </button>
          )}
          <button
            onClick={() => setShowSearch(true)}
            className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 transition-colors"
            title="検索"
          >
            <Search size={16} className="text-gray-400 sm:size-[18px]" />
          </button>
          <button
            onClick={() => setShowMemo(true)}
            className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 transition-colors"
            title="メモ（日付未定）"
          >
            <StickyNote size={16} className="text-gray-400 sm:size-[18px]" />
          </button>
          <button
            onClick={handleOpenActivityLog}
            className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 transition-colors relative"
            title="更新履歴"
          >
            <Bell size={16} className={`${unreadCount > 0 ? "text-indigo-500" : "text-gray-400"} sm:size-[18px]`} />
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
          {/* その他メニュー: ゴミ箱 / 管理 / パスキー / ログアウト を集約 */}
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu((v) => !v)}
              className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 transition-colors"
              title="その他"
            >
              <MoreVertical size={16} className={`${isMaster ? "text-indigo-500" : "text-gray-400"} sm:size-[18px]`} />
            </button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 py-1 z-50">
                  {authUser.authUser?.email && (
                    <div className="px-3 py-2 border-b border-gray-50">
                      <p className="text-[10px] text-gray-400">ログイン中</p>
                      <p className="text-xs font-medium text-gray-700 truncate">{authUser.authUser.email}</p>
                    </div>
                  )}
                  <button
                    onClick={() => { setShowMoreMenu(false); setShowTrash(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 text-left"
                  >
                    <Trash2 size={14} className="text-gray-400" />
                    ゴミ箱
                  </button>
                  {isMaster && (
                    <button
                      onClick={() => { setShowMoreMenu(false); setShowAdmin(true); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 text-left"
                    >
                      <Settings size={14} className="text-indigo-500" />
                      管理
                    </button>
                  )}
                  {authUser.authUser && (
                    <button
                      onClick={() => { setShowMoreMenu(false); router.push("/passkeys"); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 text-left"
                    >
                      <Fingerprint size={14} className="text-gray-400" />
                      パスキー管理
                    </button>
                  )}
                  {authUser.authUser && (
                    <button
                      onClick={async () => {
                        setShowMoreMenu(false);
                        if (!confirm("ログアウトしますか？")) return;
                        await signOut();
                        window.location.href = "/";
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left border-t border-gray-50"
                    >
                      <LogOut size={14} />
                      ログアウト
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
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

      {/* エリアフィルターバー */}
      {(() => {
        // 表示用: 自事業所選択中はその事業所のみ、未選択は名前で重複排除
        let displayAreas: EventArea[];
        if (currentOfficeId) {
          displayAreas = eventAreas.filter((a) => a.office_id === currentOfficeId);
        } else {
          const sorted = [...eventAreas].sort((a, b) => a.sort_order - b.sort_order);
          const seen = new Set<string>();
          displayAreas = [];
          for (const a of sorted) {
            if (!seen.has(a.name)) {
              seen.add(a.name);
              displayAreas.push(a);
            }
          }
        }
        if (displayAreas.length === 0) return null;
        // 絞り込みは「同じ名前のエリア全て」にマッチ（事業所を跨いでOK）
        const isAreaActive = (a: EventArea) => {
          if (currentOfficeId) return filterAreas.includes(a.id);
          // 未選択時は名前ベースで判定
          return eventAreas
            .filter((x) => x.name === a.name)
            .some((x) => filterAreas.includes(x.id));
        };
        const toggleAreaByName = (a: EventArea) => {
          if (currentOfficeId) {
            toggleFilterArea(a.id);
            return;
          }
          // 名前が同じ全エリアIDを一括トグル
          const sameNameIds = eventAreas.filter((x) => x.name === a.name).map((x) => x.id);
          const anyActive = sameNameIds.some((id) => filterAreas.includes(id));
          setFilterAreas((prev) =>
            anyActive
              ? prev.filter((id) => !sameNameIds.includes(id))
              : [...new Set([...prev, ...sameNameIds])],
          );
        };
        return (
          <div className="bg-white border-b border-gray-100 px-3 py-1.5 flex items-center gap-2 overflow-x-auto">
            <span className="shrink-0 text-[11px] text-gray-400 font-medium">エリア</span>
            {displayAreas.map((a) => {
              const active = isAreaActive(a);
              return (
                <button
                  key={a.id}
                  onClick={() => toggleAreaByName(a)}
                  className={`shrink-0 px-2.5 h-7 rounded-full text-xs font-medium transition-all border whitespace-nowrap ${
                    active
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-white text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                  }`}
                >{a.name}</button>
              );
            })}
          </div>
        );
      })()}

      {/* 用件種別フィルタバー（個人設定でON時のみ表示） */}
      {eventTypeFilterEnabled && (() => {
        // 表示用: 自事業所選択中はその事業所＋共有(NULL)、未選択は全て
        // hidden=true は除外（getEventTypes が既に除外済み）
        const displayTypes = currentOfficeId
          ? eventTypes.filter((t) => t.office_id === currentOfficeId || t.office_id === null)
          : eventTypes;
        if (displayTypes.length === 0) return null;
        // 同名種別はまとめる（事業所跨ぎを考慮）
        const seenNames = new Set<string>();
        const uniqueTypes = displayTypes.filter((t) => {
          if (seenNames.has(t.name)) return false;
          seenNames.add(t.name);
          return true;
        });
        return (
          <div className="bg-white border-b border-gray-100 px-3 py-1.5 flex items-center gap-2 overflow-x-auto">
            <span className="shrink-0 text-[11px] text-gray-400 font-medium">用件種別</span>
            {uniqueTypes.map((t) => {
              const active = filterEventTypes.includes(t.name);
              return (
                <button
                  key={t.id}
                  onClick={() => toggleFilterEventType(t.name)}
                  className={`shrink-0 px-2.5 h-7 rounded-full text-xs font-medium transition-all border whitespace-nowrap ${
                    active
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-white text-amber-600 border-amber-300 hover:bg-amber-50"
                  }`}
                >{t.name}</button>
              );
            })}
          </div>
        );
      })()}

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
          officeId={currentOfficeId}
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
          officeId={currentOfficeId ?? undefined}
          event={selectedEvent}
          currentUser={currentUser}
          isMaster={isMaster}
          canEdit={
            // Phase 9-5: 他事業所オリジンの event は閲覧のみ (B カレンダーで A の予定は編集不可)
            // 自事業所 / 全体 view / office_id 未設定 (legacy) なら編集可
            !currentOfficeId ||
            !selectedEvent.office_id ||
            selectedEvent.office_id === currentOfficeId
          }
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
          currentOfficeId={currentOfficeId}
          onClose={() => setShowActivityLog(false)}
          onEventClick={handleActivityEventClick}
        />
      )}

      {showSearch && (
        <SearchView
          officeId={currentOfficeId ?? undefined}
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
          officeId={currentOfficeId ?? undefined}
          isMaster={isMaster}
          onClose={() => setShowTrash(false)}
          onRestored={loadEvents}
        />
      )}

      {showAdmin && (
        <AdminPanel
          tenantId={tenantId}
          onClose={() => {
            setShowAdmin(false);
            const office = currentOfficeId ?? undefined;
            getGroups(tenantId).then(setGroups).catch(() => {});
            getEventAreas(tenantId, office).then(setEventAreas).catch(() => {});
            getEventTypes(tenantId, { officeId: office }).then(setEventTypes).catch(() => {});
            // 用件種別フィルタON/OFFの個人設定を再読込
            const stored = typeof window !== "undefined"
              ? localStorage.getItem(EVENT_TYPE_FILTER_ENABLED_KEY(tenantId))
              : null;
            if (stored !== null) {
              setEventTypeFilterEnabledState(stored === "true");
              if (stored !== "true") setFilterEventTypes([]);
            }
          }}
        />
      )}

      {showMemo && (
        <MemoView
          officeId={currentOfficeId ?? undefined}
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

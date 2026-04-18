"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X, Users, Download, BarChart2, Settings, Plus, Trash2, Loader2, Lock, Tag, User, Upload, Search, ChevronUp, ChevronDown, FileUp, UserPlus, Building2, MapPin, Merge } from "lucide-react";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { ja } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import { getMembers, addMember, deleteMember, updateMemberColor, updateMemberOrder, updateMemberOffice, type Member } from "@/lib/members";
import { getOffices, type Office } from "@/lib/offices";
import { getEventTypes, addEventType, deleteEventType, updateEventTypeOffice, mergeEventTypes, type EventType } from "@/lib/event_types";
import { getEventAreas, addEventArea, updateEventArea, deleteEventArea, type EventArea } from "@/lib/event_areas";
import { detectDuplicates, executeMerge, type DuplicateGroup } from "@/lib/staff_merge";
import { verifyMasterPin, updateMasterPin, getOrderEmailSettings, updateOrderEmailSettings, getClientSelectionEnabled, updateClientSelectionEnabled } from "@/lib/settings";
import { getEventsByDateRange, getAllEvents, importEventsFromCSV } from "@/lib/events";
import { getGroups, addGroup, deleteGroup, updateGroup, type MemberGroup } from "@/lib/groups";
import { getClients, replaceClientsForOffice, parseClientCSV, updateClientOffice, getClientOfficeAssignments, setClientOfficeAssignment, type Client, type ClientOfficeAssignment } from "@/lib/clients";
import UsersTab from "@/components/UsersTab";

type Tab = "members" | "groups" | "types" | "areas" | "merge" | "clients" | "users" | "csv" | "analytics" | "settings";

const COLORS = [
  "#6366f1","#ec4899","#f97316","#10b981","#3b82f6","#8b5cf6","#ef4444","#f59e0b",
  "#06b6d4","#84cc16","#f43f5e","#a855f7","#14b8a6","#fb923c","#64748b","#d946ef",
  "#0ea5e9","#22c55e","#e11d48","#7c3aed","#0d9488","#ea580c","#475569","#c026d3",
];

type Props = { tenantId: string; onClose: () => void; onLogout: () => void };

export default function AdminPanel({ tenantId, onClose, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("members");
  const tabs = [
    { key: "members" as Tab, icon: Users, label: "メンバー" },
    { key: "groups" as Tab, icon: Users, label: "グループ" },
    { key: "types" as Tab, icon: Tag, label: "種別" },
    { key: "areas" as Tab, icon: MapPin, label: "エリア" },
    { key: "merge" as Tab, icon: Merge, label: "スタッフ統合" },
    { key: "clients" as Tab, icon: User, label: "利用者" },
    { key: "users" as Tab, icon: UserPlus, label: "ユーザー" },
    { key: "csv" as Tab, icon: Download, label: "CSV" },
    { key: "analytics" as Tab, icon: BarChart2, label: "分析" },
    { key: "settings" as Tab, icon: Settings, label: "設定" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shadow-sm shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center">
            <Lock size={14} className="text-indigo-500" />
          </div>
          <h2 className="text-base font-bold text-gray-800">管理パネル</h2>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100"><X size={20} className="text-gray-500" /></button>
      </header>

      <div className="flex border-b border-gray-100 shrink-0 overflow-x-auto">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`shrink-0 flex flex-col items-center gap-0.5 py-2 px-3 text-xs font-medium transition-colors ${
              tab === key ? "text-indigo-600 border-b-2 border-indigo-500" : "text-gray-400 hover:text-gray-600"
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "members" && <MembersTab tenantId={tenantId} />}
        {tab === "groups" && <GroupsTab tenantId={tenantId} />}
        {tab === "types" && <EventTypesTab tenantId={tenantId} />}
        {tab === "areas" && <AreasTab tenantId={tenantId} />}
        {tab === "merge" && <StaffMergeTab tenantId={tenantId} />}
        {tab === "clients" && <ClientsTab tenantId={tenantId} />}
        {tab === "users" && <UsersTab tenantId={tenantId} />}
        {tab === "csv" && <CsvTab tenantId={tenantId} />}
        {tab === "analytics" && <AnalyticsTab tenantId={tenantId} />}
        {tab === "settings" && <SettingsTab tenantId={tenantId} onLogout={onLogout} />}
      </div>
    </div>
  );
}

// ── メンバー管理 ──────────────────────────────
function MembersTab({ tenantId }: { tenantId: string }) {
  const searchParams = useSearchParams();
  const currentOfficeId = searchParams.get("office"); // nullなら全事業所
  const [members, setMembers] = useState<Member[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const [m, o] = await Promise.all([getMembers(tenantId), getOffices(tenantId)]);
      setMembers(m);
      setOffices(o);
    } finally { setLoading(false); }
  }

  // 自事業所のみ表示
  const visibleMembers = currentOfficeId
    ? members.filter((m) => m.office_id === currentOfficeId)
    : members;

  const currentOfficeName = currentOfficeId
    ? offices.find((o) => o.id === currentOfficeId)?.name ?? null
    : null;

  // メンバーが読み込まれたら未使用の色を自動選択（表示中メンバー基準）
  useEffect(() => {
    const usedColors = new Set(visibleMembers.map((m) => m.color));
    const unused = COLORS.find((c) => !usedColors.has(c));
    if (unused) setNewColor(unused);
  }, [members, currentOfficeId]);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const m = await addMember(name, newColor, tenantId);
      // 自事業所選択中なら自動で office_id を紐付け
      if (currentOfficeId) {
        await updateMemberOffice(m.id, currentOfficeId);
        m.office_id = currentOfficeId;
      }
      setMembers((prev) => [...prev, m].sort((a, b) => a.name.localeCompare(b.name, "ja")));
      setNewName("");
    } catch { alert("追加に失敗しました（同名のメンバーが既に存在する可能性があります）"); }
    finally { setAdding(false); }
  }

  async function handleColorChange(id: string, color: string) {
    try {
      await updateMemberColor(id, color);
      setMembers((prev) => prev.map((m) => m.id === id ? { ...m, color } : m));
    } catch {}
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;
    // visibleMembers ベースで隣接ペアを取得し、実データ(members) 内で入れ替える
    const a = visibleMembers[index - 1];
    const b = visibleMembers[index];
    const orderA = a.sort_order ?? index;
    const orderB = b.sort_order ?? index + 1;
    try {
      await updateMemberOrder(a.id, orderB);
      await updateMemberOrder(b.id, orderA);
      setMembers((prev) => {
        // sort_order を入れ替え、実配列内でも位置を swap する
        const idxA = prev.findIndex((m) => m.id === a.id);
        const idxB = prev.findIndex((m) => m.id === b.id);
        if (idxA < 0 || idxB < 0) return prev;
        const next = [...prev];
        next[idxA] = { ...b, sort_order: orderA };
        next[idxB] = { ...a, sort_order: orderB };
        return next;
      });
    } catch {}
  }

  async function handleMoveDown(index: number) {
    if (index === visibleMembers.length - 1) return;
    await handleMoveUp(index + 1);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    try {
      await deleteMember(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch { alert("削除に失敗しました"); }
  }

  return (
    <div className="p-4 space-y-4">
      {currentOfficeName && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-1.5">
          <Building2 size={13} />
          <span>自事業所「{currentOfficeName}」のメンバーのみ表示中</span>
        </div>
      )}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input type="text" placeholder="メンバー名" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
          <button onClick={handleAdd} disabled={adding || !newName.trim()}
            className="px-4 py-2.5 bg-indigo-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-indigo-600 flex items-center gap-1.5">
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}追加
          </button>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-gray-400">カラー：</span>
          {COLORS.map((c) => {
            const selected = newColor === c;
            return (
              <button key={c} onClick={() => setNewColor(c)}
                className="w-6 h-6 rounded-full transition-all hover:scale-110 hover:opacity-100"
                style={{
                  backgroundColor: c,
                  opacity: selected ? 1 : 0.3,
                  outline: selected ? `3px solid ${c}` : "none",
                  outlineOffset: "2px",
                  transform: selected ? "scale(1.15)" : undefined,
                }} />
            );
          })}
        </div>
      </div>

      {loading ? <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
        : visibleMembers.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">{currentOfficeName ? "この事業所のメンバーはいません" : "メンバーがいません"}</p>
        : (
          <div className="space-y-2">
            {visibleMembers.map((m, index) => (
              <div key={m.id} className="bg-gray-50 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    {/* 並び替えボタン */}
                    <div className="flex flex-col gap-1">
                      <button onClick={() => handleMoveUp(index)} disabled={index === 0}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-indigo-500 hover:border-indigo-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors active:bg-gray-50">
                        <ChevronUp size={18} />
                      </button>
                      <button onClick={() => handleMoveDown(index)} disabled={index === visibleMembers.length - 1}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-indigo-500 hover:border-indigo-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors active:bg-gray-50">
                        <ChevronDown size={18} />
                      </button>
                    </div>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: m.color }}>
                      <span className="text-xs font-bold text-white">{m.name.charAt(0)}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-700">{m.name}</span>
                  </div>
                  <button onClick={() => handleDelete(m.id, m.name)}
                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50">
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="flex gap-1.5 flex-wrap ml-14">
                  {COLORS.map((c) => {
                    const selected = m.color === c;
                    return (
                      <button key={c} onClick={() => handleColorChange(m.id, c)}
                        className="w-5 h-5 rounded-full transition-all hover:scale-110 hover:opacity-100"
                        style={{
                          backgroundColor: c,
                          opacity: selected ? 1 : 0.3,
                          outline: selected ? `2px solid ${c}` : "none",
                          outlineOffset: "2px",
                          transform: selected ? "scale(1.15)" : undefined,
                        }} />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── グループ管理 ──────────────────────────────
function GroupsTab({ tenantId }: { tenantId: string }) {
  const searchParams = useSearchParams();
  const currentOfficeId = searchParams.get("office");
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getGroups(tenantId), getMembers(tenantId), getOffices(tenantId)])
      .then(([g, m, o]) => { setGroups(g); setMembers(m); setOffices(o); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 自事業所絞り込み
  const visibleMembers = currentOfficeId
    ? members.filter((m) => m.office_id === currentOfficeId)
    : members;
  const officeMemberNames = new Set(visibleMembers.map((m) => m.name));
  const visibleGroups = currentOfficeId
    ? groups.filter((g) => g.member_names.some((n) => officeMemberNames.has(n)))
    : groups;
  const currentOfficeName = currentOfficeId
    ? offices.find((o) => o.id === currentOfficeId)?.name ?? null
    : null;

  function toggleMember(name: string) {
    setSelected((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  }

  async function handleSave() {
    if (!groupName.trim() || selected.length === 0) return;
    if (editId) {
      await updateGroup(editId, groupName.trim(), selected);
      setGroups((prev) => prev.map((g) => g.id === editId ? { ...g, name: groupName.trim(), member_names: selected } : g));
      setEditId(null);
    } else {
      const g = await addGroup(groupName.trim(), selected, tenantId);
      setGroups((prev) => [...prev, g]);
    }
    setGroupName(""); setSelected([]);
  }

  function startEdit(g: MemberGroup) {
    setEditId(g.id); setGroupName(g.name); setSelected([...g.member_names]);
  }

  function cancelEdit() {
    setEditId(null); setGroupName(""); setSelected([]);
  }

  async function handleDelete(id: string) {
    await deleteGroup(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
    if (editId === id) cancelEdit();
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-300" /></div>;

  return (
    <div className="p-4 space-y-4">
      {currentOfficeName && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-1.5">
          <Building2 size={13} />
          <span>自事業所「{currentOfficeName}」のメンバーを含むグループのみ表示中</span>
        </div>
      )}
      {/* グループ一覧 */}
      {visibleGroups.length > 0 && (
        <div className="space-y-2">
          {visibleGroups.map((g) => (
            <div key={g.id} className="bg-gray-50 rounded-xl p-3 flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{g.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{g.member_names.join("・")}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => startEdit(g)}
                  className="text-xs text-indigo-500 font-medium px-2 py-1 rounded-lg hover:bg-indigo-50">編集</button>
                <button onClick={() => handleDelete(g.id)}
                  className="text-xs text-red-400 font-medium px-2 py-1 rounded-lg hover:bg-red-50">削除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 追加・編集フォーム */}
      <div className="border border-gray-200 rounded-xl p-3 space-y-3">
        <p className="text-xs font-semibold text-gray-500">{editId ? "グループを編集" : "新しいグループ"}</p>
        <input
          value={groupName} onChange={(e) => setGroupName(e.target.value)}
          placeholder="グループ名（例：木更津エリア）"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400"
        />
        <div>
          <p className="text-xs text-gray-400 mb-2">メンバーを選択</p>
          <div className="flex flex-wrap gap-2">
            {visibleMembers.map((m) => {
              const on = selected.includes(m.name);
              return (
                <button key={m.id} onClick={() => toggleMember(m.name)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all border"
                  style={{
                    backgroundColor: on ? m.color : "white",
                    color: on ? "white" : m.color,
                    borderColor: m.color,
                  }}>
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave}
            disabled={!groupName.trim() || selected.length === 0}
            className="flex-1 bg-indigo-500 text-white text-sm font-semibold py-2 rounded-xl disabled:opacity-40">
            {editId ? "更新" : "追加"}
          </button>
          {editId && (
            <button onClick={cancelEdit}
              className="px-4 text-sm text-gray-500 font-medium border border-gray-200 rounded-xl">
              キャンセル
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── エリア管理（事業所ごと） ──────────────────────────────
function AreasTab({ tenantId }: { tenantId: string }) {
  const searchParams = useSearchParams();
  const currentOfficeId = searchParams.get("office");
  const [areas, setAreas] = useState<EventArea[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newOfficeId, setNewOfficeId] = useState<string | null>(currentOfficeId);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const [a, o] = await Promise.all([getEventAreas(tenantId), getOffices(tenantId)]);
      setAreas(a);
      setOffices(o);
    } finally { setLoading(false); }
  }

  const currentOfficeName = currentOfficeId
    ? offices.find((o) => o.id === currentOfficeId)?.name ?? null
    : null;

  // 表示対象を絞り込み（自事業所選択中はその事業所のエリア）
  const visibleAreas = currentOfficeId
    ? areas.filter((a) => a.office_id === currentOfficeId)
    : areas;

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const a = await addEventArea(tenantId, newOfficeId, name);
      setAreas((prev) => [...prev, a]);
      setNewName("");
    } catch { alert("追加に失敗しました（同名のエリアが既に存在する可能性があります）"); }
    finally { setAdding(false); }
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    try {
      await updateEventArea(id, { name: editName.trim() });
      setAreas((prev) => prev.map((a) => a.id === id ? { ...a, name: editName.trim() } : a));
      setEditingId(null);
    } catch { alert("更新に失敗しました"); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？\nこのエリアを設定中の予定は「未設定」になります。`)) return;
    try {
      await deleteEventArea(id);
      setAreas((prev) => prev.filter((a) => a.id !== id));
    } catch { alert("削除に失敗しました"); }
  }

  // 事業所IDでエリアをグループ化
  const areasByOffice = new Map<string | null, EventArea[]>();
  for (const a of visibleAreas) {
    const key = a.office_id ?? null;
    if (!areasByOffice.has(key)) areasByOffice.set(key, []);
    areasByOffice.get(key)!.push(a);
  }

  return (
    <div className="p-4 space-y-4">
      {currentOfficeName && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-1.5">
          <Building2 size={13} />
          <span>自事業所「{currentOfficeName}」のエリアのみ表示中</span>
        </div>
      )}

      {/* 追加フォーム */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <select
            value={newOfficeId ?? ""}
            onChange={(e) => setNewOfficeId(e.target.value || null)}
            className="text-sm border-2 border-gray-200 rounded-xl px-2.5 py-2.5 bg-white focus:outline-none focus:border-indigo-400"
          >
            <option value="">事業所を選択</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="エリア名（例：市原）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim() || !newOfficeId}
            className="px-4 py-2.5 bg-indigo-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-indigo-600 flex items-center gap-1.5"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}追加
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : visibleAreas.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">エリアがありません</p>
      ) : (
        <div className="space-y-4">
          {Array.from(areasByOffice.entries()).map(([officeId, list]) => {
            const office = offices.find((o) => o.id === officeId);
            return (
              <div key={officeId ?? "__null__"} className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                  <Building2 size={12} />
                  {office?.name ?? "（事業所未設定）"}
                </p>
                <div className="space-y-1.5">
                  {list.map((a) => (
                    <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 gap-2">
                      {editingId === a.id ? (
                        <>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(a.id)}
                            className="flex-1 text-sm border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none"
                            autoFocus
                          />
                          <button onClick={() => handleSaveEdit(a.id)}
                            className="text-xs text-white bg-indigo-500 px-2.5 py-1 rounded-lg">保存</button>
                          <button onClick={() => setEditingId(null)}
                            className="text-xs text-gray-500 px-2 py-1 rounded-lg">キャンセル</button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-gray-700 flex-1">{a.name}</span>
                          <button onClick={() => { setEditingId(a.id); setEditName(a.name); }}
                            className="text-xs text-indigo-500 px-2 py-0.5 rounded-lg hover:bg-indigo-50">編集</button>
                          <button onClick={() => handleDelete(a.id, a.name)}
                            className="p-1.5 text-gray-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── スタッフ統合（エリア付き重複スタッフを統合） ──────────────────────
function StaffMergeTab({ tenantId }: { tenantId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [areas, setAreas] = useState<EventArea[]>([]);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // 各グループを実行対象にするかどうか
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const [m, a] = await Promise.all([getMembers(tenantId), getEventAreas(tenantId)]);
      setMembers(m);
      setAreas(a);
      const g = detectDuplicates(m, a);
      setGroups(g);
      // デフォルトで全選択
      setSelectedGroups(new Set(g.map((grp) => grp.baseName)));
    } finally { setLoading(false); }
  }

  const toggleGroup = (baseName: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(baseName)) next.delete(baseName);
      else next.add(baseName);
      return next;
    });
  };

  async function handleExecute() {
    const targetGroups = groups.filter((g) => selectedGroups.has(g.baseName));
    if (targetGroups.length === 0) {
      alert("統合対象のグループを選択してください");
      return;
    }
    const totalVariants = targetGroups.reduce(
      (sum, g) => sum + g.variants.filter((v) => v.areaName !== null).length,
      0,
    );
    if (!confirm(
      `${targetGroups.length}グループ（${totalVariants}件のエリア付きスタッフ）を統合します。\n\n` +
      `・対象予定の担当者を基本名に書き換え\n` +
      `・対象予定のエリアを自動設定（未設定の場合のみ）\n` +
      `・エリア付き変種メンバーを削除\n\n` +
      `この操作は元に戻せません。続行しますか？`
    )) return;

    setExecuting(true);
    setResult(null);
    try {
      const res = await executeMerge(tenantId, targetGroups, areas, members);
      setResult(
        `✅ 完了: 予定${res.updatedEvents}件を更新、` +
        `変種${res.deletedMembers}件を削除` +
        (res.createdBaseMembers > 0 ? `、基本名${res.createdBaseMembers}件を新規作成` : "")
      );
      await load();
    } catch (e) {
      console.error(e);
      setResult(`❌ エラー: ${(e as Error).message}`);
    } finally {
      setExecuting(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-300" /></div>;

  return (
    <div className="p-4 space-y-4">
      <div className="bg-indigo-50 rounded-xl p-3 space-y-1.5">
        <p className="text-xs font-semibold text-indigo-700">スタッフ統合機能</p>
        <p className="text-xs text-indigo-600 leading-relaxed">
          「山田（市原）」「山田（木更津）」のようにエリア名が付いたメンバーを検出します。<br />
          統合すると：<br />
          ① 該当予定の担当者を「山田」に書き換え<br />
          ② 該当予定の<strong>エリアを自動設定</strong>（未設定の場合のみ）<br />
          ③ 「山田（市原）」「山田（木更津）」のメンバーを削除
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          統合対象が検出されませんでした。<br />
          <span className="text-xs">「名前（エリア名）」形式のメンバーがいないか、該当エリアが登録されていません。</span>
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">{groups.length}グループ検出（選択中 {selectedGroups.size}）</p>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedGroups(new Set(groups.map((g) => g.baseName)))}
                className="text-xs text-indigo-500 font-medium px-2 py-1 rounded-lg hover:bg-indigo-50"
              >全選択</button>
              <button
                onClick={() => setSelectedGroups(new Set())}
                className="text-xs text-gray-500 font-medium px-2 py-1 rounded-lg hover:bg-gray-100"
              >全解除</button>
            </div>
          </div>

          <div className="space-y-2">
            {groups.map((g) => {
              const active = selectedGroups.has(g.baseName);
              const areaVariants = g.variants.filter((v) => v.areaName !== null);
              const hasBase = g.variants.some((v) => v.areaName === null);
              return (
                <div
                  key={g.baseName}
                  className={`rounded-xl p-3 border transition-colors ${active ? "bg-indigo-50 border-indigo-200" : "bg-gray-50 border-gray-100"}`}
                >
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleGroup(g.baseName)}
                      className="mt-1 accent-indigo-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">
                        基本名: <span className="text-indigo-600">{g.baseName}</span>
                        {!hasBase && <span className="ml-2 text-xs text-amber-600 font-medium">（新規作成）</span>}
                      </p>
                      <div className="mt-1.5 space-y-0.5">
                        {areaVariants.map((v) => (
                          <div key={v.member.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: v.member.color }} />
                            <span className="font-medium">{v.member.name}</span>
                            <span className="text-gray-400">→</span>
                            <span className="text-emerald-600 font-medium">エリア: {v.areaName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </label>
                </div>
              );
            })}
          </div>

          <button
            onClick={handleExecute}
            disabled={executing || selectedGroups.size === 0}
            className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm"
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <Merge size={16} />}
            {executing ? "統合中..." : `選択した${selectedGroups.size}グループを統合する`}
          </button>

          {result && (
            <p className={`text-sm font-medium text-center ${result.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>
              {result}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── 用件種別管理 ──────────────────────────────
function EventTypesTab({ tenantId }: { tenantId: string }) {
  const searchParams = useSearchParams();
  const currentOfficeId = searchParams.get("office");
  const [types, setTypes] = useState<EventType[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  // 統合機能
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const [t, o] = await Promise.all([getEventTypes(tenantId), getOffices(tenantId)]);
      setTypes(t);
      setOffices(o);
    } finally { setLoading(false); }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMergeModal = () => {
    if (selectedIds.size < 2) return;
    // デフォルト統合先: 最も短い名前（最もシンプルなもの）
    const selected = types.filter((t) => selectedIds.has(t.id));
    const shortest = selected.reduce((a, b) => a.name.length <= b.name.length ? a : b);
    setMergeTargetId(shortest.id);
    setShowMergeModal(true);
  };

  async function handleMerge() {
    if (!mergeTargetId) return;
    const target = types.find((t) => t.id === mergeTargetId);
    if (!target) return;
    const mergeSourceTypes = types.filter(
      (t) => selectedIds.has(t.id) && t.id !== mergeTargetId,
    );
    if (mergeSourceTypes.length === 0) {
      alert("統合元がありません");
      return;
    }
    if (!confirm(
      `以下を「${target.name}」に統合します：\n\n` +
      mergeSourceTypes.map((t) => `・${t.name}`).join("\n") +
      `\n\n予定内の種別名も自動で「${target.name}」に書き換えます。\nこの操作は元に戻せません。続行しますか？`
    )) return;

    setMerging(true);
    try {
      const res = await mergeEventTypes(
        tenantId,
        target.name,
        mergeSourceTypes.map((t) => t.id),
        mergeSourceTypes.map((t) => t.name),
      );
      alert(`✅ 完了: 予定${res.updatedEvents}件を更新、種別${res.deletedTypes}件を削除`);
      setShowMergeModal(false);
      setSelectedIds(new Set());
      setMergeTargetId(null);
      await load();
    } catch (e) {
      alert(`❌ エラー: ${(e as Error).message}`);
    } finally {
      setMerging(false);
    }
  }

  const currentOfficeName = currentOfficeId
    ? offices.find((o) => o.id === currentOfficeId)?.name ?? null
    : null;

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const t = await addEventType(name, tenantId, currentOfficeId);
      setTypes((prev) => [...prev, t]);
      setNewName("");
    } catch { alert("追加に失敗しました（同名の種別が既に存在する可能性があります）"); }
    finally { setAdding(false); }
  }

  async function handleChangeOffice(id: string, officeId: string | null) {
    try {
      await updateEventTypeOffice(id, officeId);
      setTypes((prev) => prev.map((t) => t.id === id ? { ...t, office_id: officeId } : t));
    } catch { alert("事業所の変更に失敗しました"); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    try {
      await deleteEventType(id);
      setTypes((prev) => prev.filter((t) => t.id !== id));
    } catch { alert("削除に失敗しました"); }
  }

  // 表示: 自事業所選択中は「その事業所 または 共有(NULL)」のみ
  const officeFilteredTypes = currentOfficeId
    ? types.filter((t) => t.office_id === currentOfficeId || t.office_id === null)
    : types;

  // 検索絞り込み
  const visibleTypes = search.trim()
    ? officeFilteredTypes.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()))
    : officeFilteredTypes;

  return (
    <div className="p-4 space-y-4">
      {currentOfficeName && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-1.5">
          <Building2 size={13} />
          <span>自事業所「{currentOfficeName}」＋共有種別を表示中（追加は自事業所に紐付け）</span>
        </div>
      )}
      <div className="flex gap-2">
        <input type="text" placeholder="種別名を入力" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
        <button onClick={handleAdd} disabled={adding || !newName.trim()}
          className="px-4 py-2.5 bg-indigo-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-indigo-600 flex items-center gap-1.5">
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}追加
        </button>
      </div>

      {/* 検索 */}
      <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="似た種別を探す（例：面談）"
          className="flex-1 text-sm bg-transparent placeholder-gray-300 focus:outline-none"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-gray-300 hover:text-gray-500">
            <X size={14} />
          </button>
        )}
      </div>

      {/* 統合ボタン（2件以上選択時） */}
      {selectedIds.size >= 2 && (
        <button
          onClick={openMergeModal}
          className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm"
        >
          <Merge size={14} />
          選択した{selectedIds.size}件を統合する
        </button>
      )}

      {loading ? <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
        : visibleTypes.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">該当なし</p>
        : (
          <>
            <p className="text-xs text-gray-400">
              {officeFilteredTypes.length}件中 {visibleTypes.length}件表示 / 選択中 {selectedIds.size}件
              <span className="ml-2 text-gray-500">（2件以上選んで統合可能）</span>
            </p>
            <div className="space-y-1.5">
              {visibleTypes.map((t) => {
                const isSelected = selectedIds.has(t.id);
                return (
                  <div key={t.id} className={`flex items-center justify-between rounded-xl px-3 py-2 gap-2 transition-colors ${isSelected ? "bg-emerald-50 border border-emerald-200" : "bg-gray-50 border border-transparent"}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(t.id)}
                      className="accent-emerald-500 shrink-0"
                    />
                    <span className="text-sm font-medium text-gray-700 flex-1 min-w-0 truncate">{t.name}</span>
                    <select
                      value={t.office_id ?? ""}
                      onChange={(e) => handleChangeOffice(t.id, e.target.value || null)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:border-indigo-400 max-w-[140px]"
                    >
                      <option value="">共有（全事業所）</option>
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <button onClick={() => handleDelete(t.id, t.name)}
                      className="p-1.5 text-gray-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50 shrink-0">
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

      {/* 統合モーダル */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-gray-800">種別を統合</h3>
              <button onClick={() => setShowMergeModal(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              残す名前（統合先）を選んでください。他は全て削除され、予定内の種別も書き換えられます。
            </p>
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {types.filter((t) => selectedIds.has(t.id)).map((t) => (
                <label key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${mergeTargetId === t.id ? "bg-emerald-50 border-emerald-300" : "bg-gray-50 border-gray-200 hover:border-gray-300"}`}>
                  <input
                    type="radio"
                    name="mergeTarget"
                    checked={mergeTargetId === t.id}
                    onChange={() => setMergeTargetId(t.id)}
                    className="accent-emerald-500"
                  />
                  <span className="text-sm font-medium text-gray-800 flex-1">{t.name}</span>
                  {mergeTargetId === t.id && <span className="text-xs text-emerald-600 font-bold">✓ 残す</span>}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowMergeModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200"
              >キャンセル</button>
              <button
                onClick={handleMerge}
                disabled={merging || !mergeTargetId}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
              >
                {merging ? "統合中…" : "統合実行"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 利用者管理 ────────────────────────────────
function ClientsTab({ tenantId }: { tenantId: string }) {
  const searchParams = useSearchParams();
  const currentOfficeId = searchParams.get("office");
  const [clients, setClients] = useState<Client[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [assignments, setAssignments] = useState<ClientOfficeAssignment[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const [c, o, a] = await Promise.all([
        getClients(tenantId),
        getOffices(tenantId),
        getClientOfficeAssignments(tenantId),
      ]);
      setClients(c);
      setOffices(o);
      setAssignments(a);
    } finally { setLoading(false); }
  }

  // client_id → Set<office_id> の map
  const clientOfficeMap = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!clientOfficeMap.has(a.client_id)) clientOfficeMap.set(a.client_id, new Set());
    clientOfficeMap.get(a.client_id)!.add(a.office_id);
  }

  // 利用者の有効事業所IDの取得（junction優先、なければ clients.office_id）
  function clientOfficeIds(c: Client): Set<string> {
    const ids = clientOfficeMap.get(c.id);
    if (ids && ids.size > 0) return ids;
    if (c.office_id) return new Set([c.office_id]);
    return new Set(); // 空 = 共有
  }

  const currentOfficeName = currentOfficeId
    ? offices.find((o) => o.id === currentOfficeId)?.name ?? null
    : null;

  // 取込先ラベル（自事業所選択中ならその事業所、そうでなければ共有）
  const importTargetLabel = currentOfficeName ?? "共有（全事業所）";

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg("");
    try {
      const parsed = await parseClientCSV(file);
      const scopeMsg = currentOfficeId
        ? `「${importTargetLabel}」に紐付けて取込`
        : "共有（全事業所で見える）として取込";
      if (!confirm(`${parsed.length}件を取込：\n\n対象：${scopeMsg}\n\nよろしいですか？`)) return;

      // 現在選択中の事業所に自動紐付け（未選択なら共有）
      await replaceClientsForOffice(parsed, tenantId, currentOfficeId);

      const updated = await getClients(tenantId);
      setClients(updated);
      setImportMsg(`✅ ${parsed.length}件の取り込みが完了しました（${importTargetLabel}）`);
    } catch (err) {
      setImportMsg(`❌ 取り込みに失敗しました: ${(err as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // 自事業所選択中は「その事業所に紐付け あり」か「紐付けなし(共有)」のみ
  const officeFiltered = currentOfficeId
    ? clients.filter((c) => {
        const ids = clientOfficeIds(c);
        return ids.size === 0 || ids.has(currentOfficeId);
      })
    : clients;

  const filtered = search.trim()
    ? officeFiltered.filter((c) => c.name.includes(search) || (c.furigana ?? "").includes(search))
    : officeFiltered;

  async function handleChangeOffice(id: string, officeId: string | null) {
    try {
      // client_office_assignments を更新（kaigo-appと共有）
      await setClientOfficeAssignment(tenantId, id, officeId);
      // 後方互換: clients.office_id も同期
      await updateClientOffice(id, officeId);
      // ステート更新
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, office_id: officeId } : c));
      setAssignments((prev) => {
        const next = prev.filter((a) => a.client_id !== id);
        if (officeId) next.push({ tenant_id: tenantId, client_id: id, office_id: officeId });
        return next;
      });
    } catch { alert("事業所の変更に失敗しました"); }
  }

  return (
    <div className="p-4 space-y-4">
      {currentOfficeName && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-1.5">
          <Building2 size={13} />
          <span>自事業所「{currentOfficeName}」＋共有利用者を表示中（CSV取込は共有として登録）</span>
        </div>
      )}
      {/* CSV取り込み */}
      <div className="bg-indigo-50 rounded-xl p-3 space-y-2.5">
        <p className="text-xs font-semibold text-indigo-700">CSVファイル取り込み</p>
        <p className="text-xs text-indigo-500">
          保険.CSV（Shift-JIS形式）を選択してください。<br />
          取込先は<span className="font-bold">{importTargetLabel}</span>（現在選択中の事業所）。<br />
          同一スコープの既存データは置換されます。他スコープには影響しません。
        </p>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="w-full py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm"
        >
          {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {importing ? "取り込み中..." : `CSVを取り込む（${importTargetLabel}）`}
        </button>
        {importMsg && (
          <p className={`text-xs font-medium ${importMsg.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>
            {importMsg}
          </p>
        )}
        <input ref={fileRef} type="file" accept=".csv,.CSV" className="hidden" onChange={handleImport} />
      </div>

      {/* 検索 */}
      <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="名前・フリガナで検索..."
          className="flex-1 text-sm bg-transparent placeholder-gray-300 focus:outline-none"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-gray-300 hover:text-gray-500">
            <X size={14} />
          </button>
        )}
      </div>

      {/* 件数 */}
      {!loading && clients.length > 0 && (
        <p className="text-xs text-gray-400">
          {clients.length}件中 {filtered.length}件表示
        </p>
      )}

      {/* 一覧 */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={24} className="animate-spin text-gray-300" />
        </div>
      ) : clients.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          利用者データがありません<br />
          <span className="text-xs">CSVを取り込んでください</span>
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">見つかりません</p>
      ) : (
        <div className="space-y-1">
          {filtered.slice(0, 100).map((c) => (
            <div key={c.id} className="bg-gray-50 rounded-xl px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
              {/* アバター */}
              <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-indigo-600">{c.name.charAt(0)}</span>
              </div>
              {/* 氏名 */}
              <span className="text-sm font-semibold text-gray-800 shrink-0">{c.name}</span>
              {/* フリガナ */}
              {c.furigana && <span className="text-[11px] text-gray-400 shrink-0">{c.furigana}</span>}
              {/* 介護度 */}
              {c.care_level && <span className="text-[11px] text-indigo-500 font-medium bg-indigo-50 px-1.5 py-0.5 rounded shrink-0">{c.care_level}</span>}
              {/* 電話 */}
              {(c.phone || c.mobile) && <span className="text-[11px] text-gray-500 shrink-0">{c.phone ?? c.mobile}</span>}
              {/* 住所（伸縮・省略） */}
              {c.address && <span className="text-[11px] text-gray-400 flex-1 min-w-[120px] truncate">{c.address}</span>}
              {/* 事業所ドロップダウン */}
              <select
                value={Array.from(clientOfficeIds(c))[0] ?? ""}
                onChange={(e) => handleChangeOffice(c.id, e.target.value || null)}
                className="ml-auto text-[11px] border border-gray-200 rounded-md px-1.5 py-0.5 bg-white text-gray-600 focus:outline-none focus:border-indigo-400 shrink-0 max-w-[140px]"
                title="事業所紐付け"
              >
                <option value="">共有</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          ))}
          {filtered.length > 100 && (
            <p className="text-xs text-gray-400 text-center py-2">
              さらに {filtered.length - 100} 件あります（名前で絞り込んでください）
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── CSV出力 ──────────────────────────────────
const CSV_HEADERS = ["ID","タイトル","開始日","終了日","開始時刻","終了時刻","終日","用件種別","担当者","メモ","備考","住所","カラー","作成者","最終編集者","作成日時"];

function eventsToCsvRows(events: Awaited<ReturnType<typeof getAllEvents>>) {
  return events.map((e) => [
    e.id,
    e.title, e.start_date, e.end_date,
    e.start_time?.slice(0, 5) ?? "", e.end_time?.slice(0, 5) ?? "",
    e.all_day ? "はい" : "いいえ",
    (e.event_type ?? []).join("・"),
    (e.assignees ?? []).join("・"),
    e.description ?? "", e.notes ?? "", e.location ?? "",
    e.color ?? "#6366f1",
    e.created_by ?? "", e.updated_by ?? "",
    format(new Date(e.created_at), "yyyy/MM/dd HH:mm"),
  ]);
}

function buildCsvBlob(headers: string[], rows: (string | null | undefined)[][]): Blob {
  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// CSVテキストを行・列に分解（ダブルクォート対応）
function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  // BOM除去
  const t = text.replace(/^\uFEFF/, "");
  let row: string[] = [];
  let field = "";
  let inQuote = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQuote) {
      if (ch === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === '\n') { row.push(field); result.push(row); row = []; field = ""; }
      else if (ch === '\r') { /* skip */ }
      else { field += ch; }
    }
  }
  if (field || row.length > 0) { row.push(field); result.push(row); }
  return result.filter((r) => r.some((c) => c.trim()));
}

function CsvTab({ tenantId }: { tenantId: string }) {
  const now = new Date();
  const [startDate, setStartDate] = useState(format(startOfMonth(now), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(now, "yyyy-MM-dd"));
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [backups, setBackups] = useState<{ name: string; created_at: string }[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadBackups(); }, []);
  async function loadBackups() {
    setLoadingBackups(true);
    try {
      const { data } = await supabase.storage.from("backups").list("", { sortBy: { column: "name", order: "desc" }, limit: 30 });
      const files = (data ?? []) as { name: string; created_at?: string | null }[];
      setBackups(files.filter((f) => f.name.endsWith(".csv")).map((f) => ({ name: f.name, created_at: f.created_at ?? "" })));
    } catch { /* バケット未作成などは無視 */ }
    finally { setLoadingBackups(false); }
  }

  async function downloadBackup(fileName: string) {
    const { data } = await supabase.storage.from("backups").download(fileName);
    if (!data) return;
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const events = await getEventsByDateRange(startDate, endDate, tenantId);
      downloadBlob(buildCsvBlob(CSV_HEADERS, eventsToCsvRows(events)), `予定_${startDate}_${endDate}.csv`);
    } finally { setExporting(false); }
  }

  async function handleExportAll() {
    setExportingAll(true);
    try {
      const events = await getAllEvents(tenantId);
      downloadBlob(buildCsvBlob(CSV_HEADERS, eventsToCsvRows(events)), `予定_全期間_${format(now, "yyyyMMdd")}.csv`);
    } finally { setExportingAll(false); }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg("");
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) { setImportMsg("❌ データが見つかりませんでした"); return; }

      const headers = rows[0];
      const idIdx       = headers.indexOf("ID");
      const titleIdx    = headers.indexOf("タイトル");
      const sdIdx       = headers.indexOf("開始日");
      const edIdx       = headers.indexOf("終了日");
      const stIdx       = headers.indexOf("開始時刻");
      const etIdx       = headers.indexOf("終了時刻");
      const adIdx       = headers.indexOf("終日");
      const typeIdx     = headers.indexOf("用件種別");
      const assnIdx     = headers.indexOf("担当者");
      const descIdx     = headers.indexOf("メモ");
      const notesIdx    = headers.indexOf("備考");
      const locIdx      = headers.indexOf("住所");
      const colorIdx    = headers.indexOf("カラー");
      const createdIdx  = headers.indexOf("作成者");
      const updatedIdx  = headers.indexOf("最終編集者");

      if (titleIdx < 0 || sdIdx < 0) { setImportMsg("❌ ヘッダー形式が正しくありません（タイトル・開始日が必要です）"); return; }

      const dataRows = rows.slice(1).map((cols) => {
        const get = (i: number) => (i >= 0 ? (cols[i] ?? "").trim() : "");
        return {
          id: idIdx >= 0 ? get(idIdx) || undefined : undefined,
          title: get(titleIdx),
          start_date: get(sdIdx),
          end_date: get(edIdx) || get(sdIdx),
          start_time: get(stIdx) || null,
          end_time: get(etIdx) || null,
          all_day: get(adIdx) === "はい",
          event_type: get(typeIdx) ? get(typeIdx).split("・").filter(Boolean) : [],
          assignees: get(assnIdx) ? get(assnIdx).split("・").filter(Boolean) : [],
          description: get(descIdx) || null,
          notes: notesIdx >= 0 ? (get(notesIdx) || null) : undefined,
          location: locIdx >= 0 ? (get(locIdx) || null) : undefined,
          color: colorIdx >= 0 ? (get(colorIdx) || undefined) : undefined,
          created_by: createdIdx >= 0 ? (get(createdIdx) || null) : undefined,
          updated_by: updatedIdx >= 0 ? (get(updatedIdx) || null) : undefined,
        };
      }).filter((r) => r.title && r.start_date);

      if (!confirm(`${dataRows.length}件のデータを取り込みます。\nIDが一致する予定は更新（画像・コメントは保持）、IDなしは新規追加されます。`)) return;

      setImportProgress({ done: 0, total: dataRows.length });
      const result = await importEventsFromCSV(dataRows, tenantId, (done, total) => {
        setImportProgress({ done, total });
      });
      setImportProgress(null);
      setImportMsg(`✅ 完了：更新 ${result.updated}件、新規追加 ${result.inserted}件${result.errors > 0 ? `、エラー ${result.errors}件` : ""}`);
    } catch (err) {
      setImportProgress(null);
      setImportMsg(`❌ 取り込みに失敗しました: ${(err as Error).message}`);
    } finally {
      setImporting(false);
      setImportProgress(null);
      if (importRef.current) importRef.current.value = "";
    }
  }

  return (
    <div className="p-4 space-y-5">

      {/* ── 出力 ── */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-700">📤 CSV出力</p>
        <div className="space-y-2.5">
          {(["開始日", "終了日"] as const).map((label, i) => (
            <div key={label}>
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">{label}</label>
              <input type="date"
                value={i === 0 ? startDate : endDate}
                min={i === 1 ? startDate : undefined}
                onChange={(e) => i === 0 ? setStartDate(e.target.value) : setEndDate(e.target.value)}
                className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
            </div>
          ))}
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500">
          <p className="font-medium text-gray-700 mb-1">出力項目</p>
          <p>ID・タイトル・日付・時刻・終日・用件種別・担当者・メモ・備考・住所・カラー・作成者・最終編集者・作成日時</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} disabled={exporting}
            className="flex-1 py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm">
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            期間指定で出力
          </button>
          <button onClick={handleExportAll} disabled={exportingAll}
            className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm">
            {exportingAll ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            全期間で出力
          </button>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* ── 取り込み ── */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-700">📥 CSV取り込み</p>
        <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700 space-y-1">
          <p className="font-semibold">取り込み仕様</p>
          <p>・このアプリで出力したCSVを取り込めます</p>
          <p>・IDが一致する予定は内容を<strong>更新</strong>（画像・コメントは保持）</p>
          <p>・IDがない行は<strong>新規追加</strong></p>
          <p>・CSVにない予定は削除されません</p>
        </div>
        <button
          onClick={() => importRef.current?.click()}
          disabled={importing}
          className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm">
          {importing ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          {importing
            ? importProgress
              ? `取り込み中... ${importProgress.done.toLocaleString()} / ${importProgress.total.toLocaleString()}件`
              : "取り込み中..."
            : "CSVを取り込む"}
        </button>
        {importing && importProgress && importProgress.total > 0 && (
          <div className="space-y-1">
            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-orange-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 text-right">
              {Math.round((importProgress.done / importProgress.total) * 100)}%
            </p>
          </div>
        )}
        {importMsg && (
          <p className={`text-xs font-medium p-2.5 rounded-xl ${importMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {importMsg}
          </p>
        )}
        <input ref={importRef} type="file" accept=".csv,.CSV" className="hidden" onChange={handleImport} />
      </div>

      <div className="border-t border-gray-100" />

      {/* ── 自動バックアップ一覧 ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">🗂 自動バックアップ</p>
          <button onClick={loadBackups} className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
            {loadingBackups ? <Loader2 size={12} className="animate-spin" /> : null}
            更新
          </button>
        </div>
        <p className="text-xs text-gray-400">毎日0時（日本時間）に自動生成されます</p>
        {loadingBackups ? (
          <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
        ) : backups.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">バックアップはまだありません</p>
        ) : (
          <div className="space-y-1.5">
            {backups.map((b) => (
              <button key={b.name} onClick={() => downloadBackup(b.name)}
                className="w-full flex items-center justify-between bg-gray-50 hover:bg-indigo-50 rounded-xl px-3 py-2.5 transition-colors">
                <span className="text-sm text-gray-700">{b.name.replace("backup_", "").replace(".csv", "")}</span>
                <Download size={14} className="text-indigo-400" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 分析 ─────────────────────────────────────
function AnalyticsTab({ tenantId }: { tenantId: string }) {
  const [month, setMonth] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [assigneeCounts, setAssigneeCounts] = useState<[string, number][]>([]);
  const [typeCounts, setTypeCounts] = useState<[string, number][]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => { loadData(); }, [month]);

  async function loadData() {
    setLoading(true);
    try {
      const start = format(startOfMonth(month), "yyyy-MM-dd");
      const end = format(endOfMonth(month), "yyyy-MM-dd");
      const events = await getEventsByDateRange(start, end, tenantId);
      setTotal(events.length);

      const ac: Record<string, number> = {};
      const tc: Record<string, number> = {};
      for (const e of events) {
        for (const a of (e.assignees ?? [])) ac[a] = (ac[a] ?? 0) + 1;
        for (const t of (e.event_type ?? [])) tc[t] = (tc[t] ?? 0) + 1;
      }
      setAssigneeCounts(Object.entries(ac).sort((a, b) => b[1] - a[1]));
      setTypeCounts(Object.entries(tc).sort((a, b) => b[1] - a[1]));
    } finally { setLoading(false); }
  }

  const maxA = Math.max(...assigneeCounts.map(([,n]) => n), 1);
  const maxT = Math.max(...typeCounts.map(([,n]) => n), 1);

  return (
    <div className="p-4 space-y-5">
      {/* 月選択 */}
      <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
        <button onClick={() => setMonth((m) => subMonths(m, 1))} className="p-1 text-gray-500 hover:text-indigo-500">◀</button>
        <span className="text-sm font-bold text-gray-800">{format(month, "yyyy年M月", { locale: ja })}</span>
        <button onClick={() => setMonth((m) => addMonths(m, 1))} className="p-1 text-gray-500 hover:text-indigo-500">▶</button>
      </div>

      {loading ? <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-300" /></div> : (
        <>
          <div className="bg-indigo-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500">合計件数</p>
            <p className="text-3xl font-bold text-indigo-600">{total}<span className="text-base font-normal ml-1">件</span></p>
          </div>

          {/* 担当者別 */}
          {assigneeCounts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">担当者別</h3>
              {assigneeCounts.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-20 truncate shrink-0">{name}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full flex items-center justify-end pr-1.5 transition-all"
                      style={{ width: `${(count / maxA) * 100}%` }}>
                      <span className="text-xs text-white font-bold">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 用件種別別 */}
          {typeCounts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">用件種別別</h3>
              {typeCounts.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-20 truncate shrink-0">{name}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full flex items-center justify-end pr-1.5 transition-all"
                      style={{ width: `${(count / maxT) * 100}%` }}>
                      <span className="text-xs text-white font-bold">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {assigneeCounts.length === 0 && typeCounts.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">この月のデータがありません</p>
          )}
        </>
      )}
    </div>
  );
}

// ── 設定 ─────────────────────────────────────
function SettingsTab({ tenantId, onLogout }: { tenantId: string; onLogout: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentOfficeId = searchParams.get("office");
  const [offices, setOffices] = useState<Office[]>([]);

  useEffect(() => {
    getOffices(tenantId).then(setOffices).catch(() => {});
  }, [tenantId]);

  function switchOffice(officeId: string | null) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (officeId) params.set("office", officeId);
    else params.delete("office");
    const qs = params.toString();
    router.push(`/${tenantId}${qs ? `?${qs}` : ""}`);
  }

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<{ events: number; comments: number; members: number } | null>(null);

  // 利用者選択機能
  const [clientSelectionEnabled, setClientSelectionEnabled] = useState(true);

  useEffect(() => {
    getClientSelectionEnabled(tenantId).then(setClientSelectionEnabled).catch(() => {});
  }, [tenantId]);

  async function handleToggleClientSelection(val: boolean) {
    setClientSelectionEnabled(val);
    await updateClientSelectionEnabled(tenantId, val).catch(() => {});
  }

  // 発注メール設定
  const [orderEnabled, setOrderEnabled] = useState(false);
  const [orderTo, setOrderTo] = useState("");
  const [orderFrom, setOrderFrom] = useState("onboarding@resend.dev");
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");

  useEffect(() => {
    getOrderEmailSettings(tenantId).then((s) => {
      setOrderEnabled(s.enabled);
      setOrderTo(s.to);
      setOrderFrom(s.from || "onboarding@resend.dev");
    }).catch(() => {});
  }, [tenantId]);

  async function handleSaveOrderEmail() {
    setOrderSaving(true); setOrderMessage("");
    try {
      await updateOrderEmailSettings(tenantId, { enabled: orderEnabled, to: orderTo, from: orderFrom });
      setOrderMessage("✅ 保存しました");
    } catch { setOrderMessage("保存に失敗しました"); }
    finally { setOrderSaving(false); }
  }

  useEffect(() => {
    Promise.all([
      supabase.from("events").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
      supabase.from("comments").select("*", { count: "exact", head: true }),
      supabase.from("members").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
    ]).then(([{count: e}, {count: c}, {count: m}]) => {
      setStats({ events: e ?? 0, comments: c ?? 0, members: m ?? 0 });
    }).catch(() => {});
  }, []);

  async function handleChangePin() {
    if (!newPin.trim()) { setMessage("新しいPINを入力してください"); return; }
    if (newPin !== confirmPin) { setMessage("PINが一致しません"); return; }
    if (newPin.length < 4) { setMessage("PINは4文字以上にしてください"); return; }
    setSaving(true); setMessage("");
    try {
      if (!await verifyMasterPin(currentPin, tenantId)) { setMessage("現在のPINが正しくありません"); return; }
      await updateMasterPin(newPin, tenantId);
      setMessage("✅ PINを変更しました");
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
    } catch { setMessage("変更に失敗しました"); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-4 space-y-5">
      {/* データ使用量 */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "予定", value: stats.events, unit: "件", color: "text-indigo-600", bg: "bg-indigo-50" },
            { label: "コメント", value: stats.comments, unit: "件", color: "text-green-600", bg: "bg-green-50" },
            { label: "メンバー", value: stats.members, unit: "人", color: "text-purple-600", bg: "bg-purple-50" },
          ].map(({ label, value, unit, color, bg }) => (
            <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
              <p className="text-xs text-gray-400">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}<span className="text-xs font-normal">{unit}</span></p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">マスターPIN変更</h3>
        {[
          { p: "現在のPIN", v: currentPin, s: setCurrentPin },
          { p: "新しいPIN（4文字以上）", v: newPin, s: setNewPin },
          { p: "新しいPIN（確認）", v: confirmPin, s: setConfirmPin },
        ].map(({ p, v, s }) => (
          <input key={p} type="password" placeholder={p} value={v} onChange={(e) => s(e.target.value)}
            className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
        ))}
        {message && <p className={`text-xs ${message.includes("✅") ? "text-green-600" : "text-red-500"}`}>{message}</p>}
        <button onClick={handleChangePin} disabled={saving}
          className="w-full py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-medium rounded-xl flex items-center justify-center gap-2 text-sm">
          {saving && <Loader2 size={14} className="animate-spin" />}PINを変更
        </button>
      </div>

      {/* 自事業所切替 */}
      <div className="border-t border-gray-100 pt-4 space-y-2">
        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-700">自事業所切替</h3>
        </div>
        <p className="text-xs text-gray-400">選択した事業所のメンバー・予定だけが表示されます。URL に反映されるのでブックマーク可能です。</p>
        <select
          value={currentOfficeId ?? ""}
          onChange={(e) => switchOffice(e.target.value || null)}
          className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400 bg-white"
        >
          <option value="">全事業所（絞り込みなし）</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              [{o.service_type ?? "—"}] {o.name}
            </option>
          ))}
        </select>
      </div>

      {/* 利用者選択機能 */}
      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">利用者選択機能</h3>
            <p className="text-xs text-gray-400 mt-0.5">予定入力時の利用者選択欄を表示する</p>
          </div>
          <button
            onClick={() => handleToggleClientSelection(!clientSelectionEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${clientSelectionEnabled ? "bg-indigo-500" : "bg-gray-200"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${clientSelectionEnabled ? "translate-x-5" : ""}`} />
          </button>
        </div>
      </div>

      {/* 発注メール設定 */}
      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">発注メール機能</h3>
          <button
            onClick={() => setOrderEnabled(!orderEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${orderEnabled ? "bg-indigo-500" : "bg-gray-200"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${orderEnabled ? "translate-x-5" : ""}`} />
          </button>
        </div>
        {orderEnabled && (
          <div className="space-y-2">
            <input
              type="email"
              placeholder="送信先メールアドレス"
              value={orderTo}
              onChange={(e) => setOrderTo(e.target.value)}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
            <input
              type="email"
              placeholder="送信元メールアドレス（例：noreply@your-domain.com）"
              value={orderFrom}
              onChange={(e) => setOrderFrom(e.target.value)}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
            />
            <p className="text-xs text-gray-400">
              送信元はResendで認証済みのドメインが必要です。未設定の場合は <code>onboarding@resend.dev</code> を使用してください。
            </p>
          </div>
        )}
        {orderMessage && (
          <p className={`text-xs ${orderMessage.includes("✅") ? "text-green-600" : "text-red-500"}`}>{orderMessage}</p>
        )}
        <button
          onClick={handleSaveOrderEmail}
          disabled={orderSaving}
          className="w-full py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-medium rounded-xl flex items-center justify-center gap-2 text-sm"
        >
          {orderSaving && <Loader2 size={14} className="animate-spin" />}発注メール設定を保存
        </button>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <button onClick={() => { if (confirm("マスターモードを解除しますか？")) onLogout(); }}
          className="w-full py-2.5 border-2 border-red-100 text-red-400 hover:bg-red-50 font-medium rounded-xl text-sm">
          マスターモードを解除
        </button>
      </div>
    </div>
  );
}

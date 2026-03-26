"use client";

import { useState, useEffect } from "react";
import { X, Users, Download, BarChart2, Settings, Plus, Trash2, Loader2, Lock, Tag } from "lucide-react";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { ja } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import { getMembers, addMember, deleteMember, updateMemberColor, type Member } from "@/lib/members";
import { getEventTypes, addEventType, deleteEventType, type EventType } from "@/lib/event_types";
import { verifyMasterPin, updateMasterPin } from "@/lib/settings";
import { getEventsByDateRange } from "@/lib/events";

type Tab = "members" | "types" | "csv" | "analytics" | "settings";

const COLORS = ["#6366f1","#ec4899","#f97316","#10b981","#3b82f6","#8b5cf6","#ef4444","#f59e0b"];

type Props = { onClose: () => void; onLogout: () => void };

export default function AdminPanel({ onClose, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("members");
  const tabs = [
    { key: "members" as Tab, icon: Users, label: "メンバー" },
    { key: "types" as Tab, icon: Tag, label: "種別" },
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

      <div className="flex border-b border-gray-100 shrink-0">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
              tab === key ? "text-indigo-600 border-b-2 border-indigo-500" : "text-gray-400 hover:text-gray-600"
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "members" && <MembersTab />}
        {tab === "types" && <EventTypesTab />}
        {tab === "csv" && <CsvTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "settings" && <SettingsTab onLogout={onLogout} />}
      </div>
    </div>
  );
}

// ── メンバー管理 ──────────────────────────────
function MembersTab() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try { setMembers(await getMembers()); } finally { setLoading(false); }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const m = await addMember(name, newColor);
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

  async function handleDelete(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    try {
      await deleteMember(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch { alert("削除に失敗しました"); }
  }

  return (
    <div className="p-4 space-y-4">
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
        <div className="flex gap-1.5 items-center">
          <span className="text-xs text-gray-400">カラー：</span>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setNewColor(c)}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
              style={{ backgroundColor: c, outline: newColor === c ? `3px solid ${c}` : "none", outlineOffset: "2px" }} />
          ))}
        </div>
      </div>

      {loading ? <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
        : members.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">メンバーがいません</p>
        : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="bg-gray-50 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: m.color }}>
                      <span className="text-xs font-bold text-white">{m.name.charAt(0)}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-700">{m.name}</span>
                  </div>
                  <button onClick={() => handleDelete(m.id, m.name)}
                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50">
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="flex gap-1.5 ml-10">
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => handleColorChange(m.id, c)}
                      className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                      style={{ backgroundColor: c, outline: m.color === c ? `2px solid ${c}` : "none", outlineOffset: "2px" }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── 用件種別管理 ──────────────────────────────
function EventTypesTab() {
  const [types, setTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try { setTypes(await getEventTypes()); } finally { setLoading(false); }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const t = await addEventType(name);
      setTypes((prev) => [...prev, t]);
      setNewName("");
    } catch { alert("追加に失敗しました（同名の種別が既に存在する可能性があります）"); }
    finally { setAdding(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    try {
      await deleteEventType(id);
      setTypes((prev) => prev.filter((t) => t.id !== id));
    } catch { alert("削除に失敗しました"); }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <input type="text" placeholder="種別名を入力" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
        <button onClick={handleAdd} disabled={adding || !newName.trim()}
          className="px-4 py-2.5 bg-indigo-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-indigo-600 flex items-center gap-1.5">
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}追加
        </button>
      </div>

      {loading ? <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
        : types.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">種別がありません</p>
        : (
          <div className="space-y-2">
            {types.map((t) => (
              <div key={t.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
                <span className="text-sm font-medium text-gray-700">{t.name}</span>
                <button onClick={() => handleDelete(t.id, t.name)}
                  className="p-1.5 text-gray-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── CSV出力 ──────────────────────────────────
function CsvTab() {
  const now = new Date();
  const [startDate, setStartDate] = useState(format(startOfMonth(now), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(now, "yyyy-MM-dd"));
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const events = await getEventsByDateRange(startDate, endDate);
      const headers = ["タイトル","開始日","終了日","開始時刻","終了時刻","終日","用件種別","担当者","メモ","作成者","最終編集者","作成日時"];
      const rows = events.map((e) => [
        e.title, e.start_date, e.end_date,
        e.start_time?.slice(0,5) ?? "", e.end_time?.slice(0,5) ?? "",
        e.all_day ? "はい" : "いいえ",
        (e.event_type ?? []).join("・"),
        (e.assignees ?? []).join("・"),
        e.description ?? "", e.created_by ?? "", e.updated_by ?? "",
        format(new Date(e.created_at), "yyyy/MM/dd HH:mm"),
      ]);
      const csv = [headers, ...rows]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g,'""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `予定_${startDate}_${endDate}.csv`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-3">
        {[["開始日", startDate, setStartDate, ""], ["終了日", endDate, setEndDate, startDate]].map(([label, value, setter, min]) => (
          <div key={String(label)}>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">{String(label)}</label>
            <input type="date" value={String(value)} min={String(min) || undefined}
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
          </div>
        ))}
      </div>
      <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500">
        <p className="font-medium text-gray-700 mb-1">出力項目</p>
        <p>タイトル・日付・時刻・終日・用件種別・担当者・メモ・作成者・最終編集者・作成日時</p>
      </div>
      <button onClick={handleExport} disabled={exporting}
        className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2">
        {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        CSVをダウンロード
      </button>
    </div>
  );
}

// ── 分析 ─────────────────────────────────────
function AnalyticsTab() {
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
      const events = await getEventsByDateRange(start, end);
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
function SettingsTab({ onLogout }: { onLogout: () => void }) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<{ events: number; comments: number; members: number } | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("events").select("*", { count: "exact", head: true }).is("deleted_at", null),
      supabase.from("comments").select("*", { count: "exact", head: true }),
      supabase.from("members").select("*", { count: "exact", head: true }),
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
      if (!await verifyMasterPin(currentPin)) { setMessage("現在のPINが正しくありません"); return; }
      await updateMasterPin(newPin);
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

      <div className="border-t border-gray-100 pt-4">
        <button onClick={() => { if (confirm("マスターモードを解除しますか？")) onLogout(); }}
          className="w-full py-2.5 border-2 border-red-100 text-red-400 hover:bg-red-50 font-medium rounded-xl text-sm">
          マスターモードを解除
        </button>
      </div>
    </div>
  );
}

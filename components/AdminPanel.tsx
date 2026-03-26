"use client";

import { useState, useEffect } from "react";
import { X, Users, Download, BarChart2, Settings, Plus, Trash2, Loader2, Lock } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { getMembers, addMember, deleteMember, type Member } from "@/lib/members";
import { verifyMasterPin, updateMasterPin } from "@/lib/settings";
import { getEventsByDateRange } from "@/lib/events";

type Tab = "members" | "csv" | "usage" | "settings";

type Props = {
  onClose: () => void;
  onLogout: () => void;
};

export default function AdminPanel({ onClose, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("members");

  const tabs = [
    { key: "members" as Tab, icon: Users, label: "メンバー" },
    { key: "csv" as Tab, icon: Download, label: "CSV出力" },
    { key: "usage" as Tab, icon: BarChart2, label: "データ" },
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
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100">
          <X size={20} className="text-gray-500" />
        </button>
      </header>

      <div className="flex border-b border-gray-100 shrink-0">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
              tab === key ? "text-indigo-600 border-b-2 border-indigo-500" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "members" && <MembersTab />}
        {tab === "csv" && <CsvTab />}
        {tab === "usage" && <UsageTab />}
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
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setMembers(await getMembers()); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const m = await addMember(name);
      setMembers((prev) => [...prev, m].sort((a, b) => a.name.localeCompare(b.name, "ja")));
      setNewName("");
    } catch {
      alert("追加に失敗しました（同名のメンバーが既に存在する可能性があります）");
    } finally { setAdding(false); }
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
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="メンバー名を入力"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !newName.trim()}
          className="px-4 py-2.5 bg-indigo-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-indigo-600 transition-colors flex items-center gap-1.5"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          追加
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">メンバーがいません</p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold text-indigo-600">{m.name.charAt(0)}</span>
                </div>
                <span className="text-sm font-medium text-gray-700">{m.name}</span>
              </div>
              <button
                onClick={() => handleDelete(m.id, m.name)}
                className="p-1.5 text-gray-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50"
              >
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
  const firstDay = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
  const today = format(now, "yyyy-MM-dd");
  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(today);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const events = await getEventsByDateRange(startDate, endDate);
      const headers = ["タイトル", "開始日", "終了日", "開始時刻", "終了時刻", "終日", "担当者", "メモ", "作成者", "最終編集者", "作成日時"];
      const rows = events.map((e) => [
        e.title,
        e.start_date,
        e.end_date,
        e.start_time?.slice(0, 5) ?? "",
        e.end_time?.slice(0, 5) ?? "",
        e.all_day ? "はい" : "いいえ",
        (e.assignees ?? []).join("・"),
        e.description ?? "",
        e.created_by ?? "",
        e.updated_by ?? "",
        format(new Date(e.created_at), "yyyy/MM/dd HH:mm"),
      ]);
      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `予定_${startDate}_${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1.5 block">開始日</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1.5 block">終了日</label>
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
            className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-700 mb-1">出力項目</p>
        <p>タイトル・開始日・終了日・時刻・終日・担当者・メモ・作成者・最終編集者・作成日時</p>
      </div>

      <button
        onClick={handleExport}
        disabled={exporting}
        className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        CSVをダウンロード
      </button>
    </div>
  );
}

// ── データ使用量 ──────────────────────────────
function UsageTab() {
  const [stats, setStats] = useState<{ events: number; deleted: number; comments: number; members: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    setLoading(true);
    try {
      const [
        { count: events },
        { count: deleted },
        { count: comments },
        { count: members },
      ] = await Promise.all([
        supabase.from("events").select("*", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("events").select("*", { count: "exact", head: true }).not("deleted_at", "is", null),
        supabase.from("comments").select("*", { count: "exact", head: true }),
        supabase.from("members").select("*", { count: "exact", head: true }),
      ]);
      setStats({ events: events ?? 0, deleted: deleted ?? 0, comments: comments ?? 0, members: members ?? 0 });
    } finally { setLoading(false); }
  }

  const statCards = stats ? [
    { label: "有効な予定", value: stats.events, unit: "件", bg: "bg-indigo-50", text: "text-indigo-600" },
    { label: "ゴミ箱", value: stats.deleted, unit: "件", bg: "bg-orange-50", text: "text-orange-500" },
    { label: "コメント", value: stats.comments, unit: "件", bg: "bg-green-50", text: "text-green-600" },
    { label: "メンバー", value: stats.members, unit: "人", bg: "bg-purple-50", text: "text-purple-600" },
  ] : [];

  return (
    <div className="p-4 space-y-4">
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {statCards.map(({ label, value, unit, bg, text }) => (
              <div key={label} className={`rounded-xl p-4 ${bg}`}>
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-2xl font-bold ${text}`}>
                  {value}<span className="text-sm font-normal ml-0.5">{unit}</span>
                </p>
              </div>
            ))}
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-400 text-center leading-relaxed">
            画像などの詳細なストレージ使用量は<br />
            <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer"
              className="text-indigo-400 underline">Supabaseダッシュボード</a>で確認できます
          </div>
          <button onClick={loadStats}
            className="w-full py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition-colors">
            更新
          </button>
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

  async function handleChangePin() {
    if (!newPin.trim()) { setMessage("新しいPINを入力してください"); return; }
    if (newPin !== confirmPin) { setMessage("PINが一致しません"); return; }
    if (newPin.length < 4) { setMessage("PINは4文字以上にしてください"); return; }
    setSaving(true);
    setMessage("");
    try {
      const ok = await verifyMasterPin(currentPin);
      if (!ok) { setMessage("現在のPINが正しくありません"); return; }
      await updateMasterPin(newPin);
      setMessage("✅ PINを変更しました");
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
    } catch { setMessage("変更に失敗しました"); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-4 space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">マスターPIN変更</h3>
        {[
          { placeholder: "現在のPIN", value: currentPin, onChange: setCurrentPin },
          { placeholder: "新しいPIN（4文字以上）", value: newPin, onChange: setNewPin },
          { placeholder: "新しいPIN（確認）", value: confirmPin, onChange: setConfirmPin },
        ].map(({ placeholder, value, onChange }) => (
          <input key={placeholder} type="password" placeholder={placeholder} value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-400" />
        ))}
        {message && (
          <p className={`text-xs ${message.includes("✅") ? "text-green-600" : "text-red-500"}`}>{message}</p>
        )}
        <button onClick={handleChangePin} disabled={saving}
          className="w-full py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
          {saving && <Loader2 size={14} className="animate-spin" />}
          PINを変更
        </button>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <button
          onClick={() => { if (confirm("マスターモードを解除しますか？")) onLogout(); }}
          className="w-full py-2.5 border-2 border-red-100 text-red-400 hover:bg-red-50 font-medium rounded-xl transition-colors text-sm"
        >
          マスターモードを解除
        </button>
      </div>
    </div>
  );
}

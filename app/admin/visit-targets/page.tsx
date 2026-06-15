"use client";

/**
 * 福祉用具管理者: エリア × 福祉用具事業所 訪問目標頻度 管理画面
 *
 * - fukuyogu_area_targets の編集 (頻度変更 / 新規追加 / 削除)
 * - エリアと事業所のセレクトボックス
 */
import { useEffect, useState, useMemo } from "react";
import { ArrowLeft, Plus, Save, Trash2, X, Edit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase-browser";
import { getVisitTargets, FUKUYOGU_OFFICE_IDS, type VisitTarget } from "@/lib/visit_analytics";

type AreaOption = { id: string; name: string; sort_order: number };
type OfficeOption = { id: string; name: string; short_name: string | null };

const FREQUENCY_PRESETS = [
  { days: 1, label: "毎日" },
  { days: 7, label: "1週に1回" },
  { days: 14, label: "2週に1回" },
  { days: 21, label: "3週に1回" },
  { days: 28, label: "4週に1回" },
  { days: 42, label: "6週に1回" },
  { days: 60, label: "2ヶ月に1回" },
];

export default function VisitTargetsAdminPage() {
  const router = useRouter();
  const [targets, setTargets] = useState<VisitTarget[]>([]);
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [offices, setOffices] = useState<OfficeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDays, setEditingDays] = useState<number>(21);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAreaId, setNewAreaId] = useState<string>("");
  const [newOfficeId, setNewOfficeId] = useState<string>("");
  const [newDays, setNewDays] = useState<number>(21);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    void reload();
    void loadOptions();
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const t = await getVisitTargets();
      setTargets(t);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "読込エラー");
    } finally {
      setLoading(false);
    }
  }

  async function loadOptions() {
    const sb = getSupabase();
    const [areasRes, officesRes] = await Promise.all([
      sb.from("event_areas").select("id, name, sort_order").eq("tenant_id", "fukuyogu-kanri").order("sort_order"),
      sb.from("offices").select("id, name, short_name").in("id", FUKUYOGU_OFFICE_IDS as unknown as string[]).order("name"),
    ]);
    setAreas((areasRes.data ?? []) as AreaOption[]);
    setOffices((officesRes.data ?? []) as OfficeOption[]);
  }

  async function handleSave(id: string) {
    setErrorMsg(null);
    const sb = getSupabase();
    const { error } = await sb
      .from("fukuyogu_area_targets")
      .update({ target_frequency_days: editingDays })
      .eq("id", id);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setEditingId(null);
    await reload();
  }

  async function handleDelete(id: string) {
    if (!confirm("この目標頻度設定を削除しますか?")) return;
    setErrorMsg(null);
    const sb = getSupabase();
    const { error } = await sb.from("fukuyogu_area_targets").delete().eq("id", id);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await reload();
  }

  async function handleAdd() {
    setErrorMsg(null);
    if (!newAreaId || !newOfficeId || newDays <= 0) {
      setErrorMsg("エリア・事業所・頻度を選択してください");
      return;
    }
    const sb = getSupabase();
    const { error } = await sb.from("fukuyogu_area_targets").insert({
      tenant_id: "fukuyogu-kanri",
      area_id: newAreaId,
      office_id: newOfficeId,
      target_frequency_days: newDays,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setShowAddForm(false);
    setNewAreaId("");
    setNewOfficeId("");
    setNewDays(21);
    await reload();
  }

  // グルーピング: area で
  const grouped = useMemo(() => {
    const map = new Map<string, { area_name: string; area_sort: number; items: VisitTarget[] }>();
    for (const t of targets) {
      if (!map.has(t.area_id)) {
        map.set(t.area_id, { area_name: t.area_name, area_sort: t.area_sort_order, items: [] });
      }
      map.get(t.area_id)!.items.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].area_sort - b[1].area_sort);
  }, [targets]);

  function freqLabel(days: number): string {
    const preset = FREQUENCY_PRESETS.find((p) => p.days === days);
    return preset?.label ?? `${days}日`;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div>
            <h1 className="text-base font-bold text-gray-800">訪問目標頻度 管理</h1>
            <p className="text-xs text-gray-500">福祉用具管理者 — エリア × 事業所 ごとの訪問目標</p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold rounded-lg"
          >
            <Plus size={14} />新規追加
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {showAddForm && (
          <div className="mb-4 p-4 bg-white border border-indigo-200 rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-800">新しい目標頻度</h3>
              <button onClick={() => setShowAddForm(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">エリア</label>
                <select
                  value={newAreaId}
                  onChange={(e) => setNewAreaId(e.target.value)}
                  className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400"
                >
                  <option value="">選択...</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">事業所</label>
                <select
                  value={newOfficeId}
                  onChange={(e) => setNewOfficeId(e.target.value)}
                  className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400"
                >
                  <option value="">選択...</option>
                  {offices.map((o) => <option key={o.id} value={o.id}>{o.short_name ?? o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">頻度</label>
                <select
                  value={newDays}
                  onChange={(e) => setNewDays(Number(e.target.value))}
                  className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400"
                >
                  {FREQUENCY_PRESETS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleAdd}
                  className="w-full px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1"
                >
                  <Plus size={14} />追加
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">読込中…</div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([areaId, g]) => (
              <div key={areaId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-sm font-bold text-gray-800">{g.area_name}</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {g.items.map((t) => (
                    <div key={t.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-700 truncate">
                          {t.office_short_name ?? t.office_name}
                        </div>
                        {t.notes && (
                          <div className="text-[10px] text-gray-400 truncate">{t.notes}</div>
                        )}
                      </div>
                      {editingId === t.id ? (
                        <>
                          <select
                            value={editingDays}
                            onChange={(e) => setEditingDays(Number(e.target.value))}
                            className="text-xs border-2 border-indigo-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400"
                          >
                            {FREQUENCY_PRESETS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
                          </select>
                          <button onClick={() => handleSave(t.id)} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600">
                            <Save size={14} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full font-semibold">
                            {freqLabel(t.target_frequency_days)}
                          </span>
                          <button
                            onClick={() => { setEditingId(t.id); setEditingDays(t.target_frequency_days); }}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-400"
                            title="編集"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(t.id)}
                            className="p-1.5 rounded hover:bg-red-50 text-red-400"
                            title="削除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {grouped.length === 0 && (
              <div className="text-center py-12 text-sm text-gray-400">
                データがありません。「新規追加」から登録してください。
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

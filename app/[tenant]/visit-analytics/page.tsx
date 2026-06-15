"use client";

/**
 * 福祉用具管理者: 訪問分析画面
 *
 * - 月選択 (prev / next / select)
 * - エリア × 事業所 グリッド: 個別/MTG カウント, 前回訪問日, 経過日数, 達成色
 * - 過去 6 ヶ月の trend
 * - セルクリックで該当 events 一覧 (Phase D)
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Settings, X, Calendar as CalendarIcon } from "lucide-react";
import {
  getVisitTargets,
  getVisitStats,
  getMonthlyTrend,
  getMonthVisitEvents,
  judgeStatus,
  type VisitTarget,
  type VisitStats,
  type MonthlyTrend,
  type Status,
} from "@/lib/visit_analytics";

type DrillEvent = {
  id: string;
  start_date: string;
  title: string;
  assignees: string[];
  event_type: string[];
};

export default function VisitAnalyticsPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = params?.tenant as string;

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [targets, setTargets] = useState<VisitTarget[]>([]);
  const [stats, setStats] = useState<Map<string, VisitStats>>(new Map());
  const [trends, setTrends] = useState<Map<string, MonthlyTrend[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"grid" | "trend">("grid");
  const [drill, setDrill] = useState<{ areaId: string; officeId: string; areaName: string; officeName: string; events: DrillEvent[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [t, s, tr] = await Promise.all([
          getVisitTargets(),
          getVisitStats(year, month),
          getMonthlyTrend(6),
        ]);
        if (cancelled) return;
        setTargets(t);
        setStats(s);
        setTrends(tr);
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year, month]);

  function shiftMonth(delta: number) {
    let y = year;
    let m = month + delta;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setYear(y);
    setMonth(m);
  }

  // エリア順
  const areas = useMemo(() => {
    const map = new Map<string, { name: string; sort: number }>();
    for (const t of targets) {
      if (!map.has(t.area_id)) map.set(t.area_id, { name: t.area_name, sort: t.area_sort_order });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].sort - b[1].sort)
      .map(([id, v]) => ({ id, name: v.name }));
  }, [targets]);

  // 事業所順 (短縮名で表示)
  const officesUsed = useMemo(() => {
    const map = new Map<string, { name: string; short: string | null }>();
    for (const t of targets) {
      if (!map.has(t.office_id)) map.set(t.office_id, { name: t.office_name, short: t.office_short_name });
    }
    return Array.from(map.entries()).map(([id, v]) => ({ id, name: v.short ?? v.name }));
  }, [targets]);

  // (area, office) → target を引く
  const targetMap = useMemo(() => {
    const m = new Map<string, VisitTarget>();
    for (const t of targets) m.set(`${t.area_id}:${t.office_id}`, t);
    return m;
  }, [targets]);

  async function handleCellClick(areaId: string, officeId: string, areaName: string, officeName: string) {
    const events = await getMonthVisitEvents(year, month, areaId, officeId);
    setDrill({ areaId, officeId, areaName, officeName, events });
  }

  function statusBg(s: Status): string {
    switch (s) {
      case "good": return "bg-emerald-50 border-emerald-200";
      case "warn": return "bg-amber-50 border-amber-200";
      case "danger": return "bg-red-50 border-red-200";
      default: return "bg-gray-50 border-gray-200";
    }
  }
  function statusText(s: Status): string {
    switch (s) {
      case "good": return "text-emerald-700";
      case "warn": return "text-amber-700";
      case "danger": return "text-red-700";
      default: return "text-gray-400";
    }
  }
  function statusIcon(s: Status): string {
    switch (s) {
      case "good": return "✓";
      case "warn": return "⚠";
      case "danger": return "🚨";
      default: return "—";
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-800">訪問分析</h1>
            <p className="text-xs text-gray-500">福祉用具管理者 — エリア × 事業所 達成状況</p>
          </div>

          {/* 月選択 (タップ領域を広くした) */}
          <div className="flex items-center gap-1 ml-auto bg-gray-50 rounded-xl px-1 py-1">
            <button
              onClick={() => shiftMonth(-1)}
              className="p-3 rounded-lg hover:bg-white active:bg-indigo-100 transition-colors"
              aria-label="前の月"
            >
              <ChevronLeft size={20} className="text-gray-700" />
            </button>
            <span className="text-base font-bold text-gray-800 px-3 min-w-[110px] text-center select-none">
              {year}年{month}月
            </span>
            <button
              onClick={() => shiftMonth(1)}
              className="p-3 rounded-lg hover:bg-white active:bg-indigo-100 transition-colors"
              aria-label="次の月"
            >
              <ChevronRight size={20} className="text-gray-700" />
            </button>
            <button
              onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); }}
              className="ml-1 px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-white rounded-lg"
            >今月</button>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={() => setView("grid")}
              className={`px-2.5 py-1 text-xs font-semibold rounded ${view === "grid" ? "bg-indigo-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}
            >今月詳細</button>
            <button
              onClick={() => setView("trend")}
              className={`px-2.5 py-1 text-xs font-semibold rounded ${view === "trend" ? "bg-indigo-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}
            >月別推移</button>
          </div>

          <button
            onClick={() => router.push("/admin/visit-targets")}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            title="目標頻度を編集"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">集計中…</div>
        ) : view === "grid" ? (
          // === 月次グリッド表示 ===
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 border-r border-gray-200">エリア</th>
                    {officesUsed.map((o) => (
                      <th key={o.id} className="px-3 py-2 text-left font-semibold text-gray-600 min-w-[140px]">
                        {o.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {areas.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50/30">
                      <td className="px-3 py-2 font-semibold text-gray-700 sticky left-0 bg-white z-10 border-r border-gray-200 whitespace-nowrap">
                        {a.name}
                      </td>
                      {officesUsed.map((o) => {
                        const t = targetMap.get(`${a.id}:${o.id}`);
                        if (!t) {
                          return <td key={o.id} className="px-3 py-2 text-gray-300 text-center">—</td>;
                        }
                        const s = stats.get(`${a.id}:${o.id}`);
                        const days = s?.last_visit_days_ago ?? null;
                        const status = judgeStatus(days, t.target_frequency_days);
                        const isColocated = (t.notes ?? "").includes("併設");
                        return (
                          <td key={o.id} className="px-2 py-1.5">
                            <button
                              onClick={() => handleCellClick(a.id, o.id, a.name, o.name)}
                              className={`w-full text-left border rounded-lg p-2 ${statusBg(status)} hover:ring-2 hover:ring-indigo-300 transition-all`}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <div className="text-[10px] text-gray-500 font-medium flex items-center gap-1 flex-wrap">
                                  <span>目標: {t.target_frequency_days === 1 ? "毎日" : t.target_frequency_days === 7 ? "1週" : t.target_frequency_days === 14 ? "2週" : t.target_frequency_days === 21 ? "3週" : t.target_frequency_days === 28 ? "4週" : `${t.target_frequency_days}日`}</span>
                                  {isColocated && (
                                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[9px] font-bold leading-none">併設</span>
                                  )}
                                </div>
                                <span className={`text-xs ${statusText(status)}`} title={status === "good" ? "目標内" : status === "warn" ? "やや超過" : status === "danger" ? "大幅超過" : "未訪問"}>{statusIcon(status)}</span>
                              </div>
                              <div className="mt-1 flex items-baseline gap-2">
                                <span className="text-xs font-bold text-gray-800">
                                  個 <span className="text-sm text-indigo-600">{s?.individual_count ?? 0}</span>
                                </span>
                                <span className="text-xs font-bold text-gray-800">
                                  M <span className="text-sm text-purple-600">{s?.meeting_count ?? 0}</span>
                                </span>
                              </div>
                              <div className="mt-1 text-[10px] text-gray-500">
                                {s?.last_visit_date ? (
                                  <>
                                    前回 {s.last_visit_date.slice(5)}{" "}
                                    <span className={statusText(status)}>({days}日経過)</span>
                                  </>
                                ) : (
                                  <span className="text-gray-400">未訪問</span>
                                )}
                              </div>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 text-[10px] text-gray-500 border-t border-gray-100 flex items-center gap-4 flex-wrap">
              <span>個: 個別訪問 / M: ミーティング時訪問</span>
              <span className="text-emerald-600">✓ 目標内</span>
              <span className="text-amber-600">⚠ やや超過 (目標 × 1.5 未満)</span>
              <span className="text-red-600">🚨 大幅超過 (目標 × 1.5 以上)</span>
              <span className="text-gray-400">— 未訪問</span>
              <span className="ml-auto">セルクリックで詳細</span>
            </div>
          </div>
        ) : (
          // === 月別推移 (trend) — 縦の列を 5 事業所で揃えた table 型 ===
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-bold text-gray-800">過去 6 ヶ月 の訪問件数推移</h3>
              <div className="text-[10px] text-gray-500 flex items-center gap-3">
                <span className="flex items-center gap-1"><div className="w-3 h-3 bg-indigo-400 rounded-sm" />個別訪問</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 bg-purple-400 rounded-sm" />ミーティング時訪問</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 border-r border-gray-200 min-w-[80px]">
                      エリア
                    </th>
                    {officesUsed.map((o) => (
                      <th key={o.id} className="px-2 py-2 text-center font-semibold text-gray-600 border-r border-gray-100 min-w-[160px]">
                        {o.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {areas.map((a) => (
                    <tr key={a.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-semibold text-gray-700 sticky left-0 bg-white z-10 border-r border-gray-200 whitespace-nowrap align-middle">
                        {a.name}
                      </td>
                      {officesUsed.map((o) => {
                        const t = targetMap.get(`${a.id}:${o.id}`);
                        if (!t) {
                          return (
                            <td key={o.id} className="px-2 py-2 text-center text-gray-300 border-r border-gray-100 bg-gray-50/40">
                              —
                            </td>
                          );
                        }
                        const list = trends.get(`${a.id}:${o.id}`) ?? [];
                        const max = Math.max(1, ...list.map((x) => x.individual_count + x.meeting_count));
                        const months: { yyyymm: string; ind: number; mtg: number }[] = [];
                        const td_ = new Date();
                        for (let i = 5; i >= 0; i--) {
                          const d = new Date(td_.getFullYear(), td_.getMonth() - i, 1);
                          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                          const data = list.find((x) => x.yyyymm === ym);
                          months.push({ yyyymm: ym, ind: data?.individual_count ?? 0, mtg: data?.meeting_count ?? 0 });
                        }
                        return (
                          <td key={o.id} className="px-2 py-2 border-r border-gray-100">
                            <div className="flex items-end gap-0.5 h-14">
                              {months.map((m) => (
                                <div key={m.yyyymm} className="flex-1 flex flex-col items-center gap-0.5">
                                  <div className="w-full flex flex-col-reverse items-stretch" style={{ height: 40 }}>
                                    {m.ind > 0 && (
                                      <div
                                        className="bg-indigo-400 rounded-t"
                                        style={{ height: `${(m.ind / max) * 100}%`, minHeight: "2px" }}
                                        title={`個別: ${m.ind}`}
                                      />
                                    )}
                                    {m.mtg > 0 && (
                                      <div
                                        className="bg-purple-400"
                                        style={{ height: `${(m.mtg / max) * 100}%`, minHeight: "2px" }}
                                        title={`MTG: ${m.mtg}`}
                                      />
                                    )}
                                  </div>
                                  <div className="text-[8px] text-gray-400">{Number(m.yyyymm.slice(5))}月</div>
                                  <div className="text-[9px] font-semibold text-gray-700">{m.ind + m.mtg}</div>
                                </div>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Phase D: ドリルダウンモーダル */}
      {drill && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl overflow-hidden">
            <header className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-800 truncate">{drill.areaName} × {drill.officeName}</h2>
                <p className="text-[10px] text-gray-500">{year}年{month}月の訪問</p>
              </div>
              <button onClick={() => setDrill(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X size={16} />
              </button>
            </header>
            <div className="max-h-[60vh] overflow-y-auto">
              {drill.events.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-gray-400">
                  この月の訪問はありません
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {drill.events.map((e) => {
                    const isIndividual = e.event_type?.some((t) => t.includes("個別訪問"));
                    const isMeeting = e.event_type?.some((t) => t.includes("ミーティング時訪問"));
                    return (
                      <div key={e.id} className="px-5 py-2.5 hover:bg-gray-50">
                        <div className="flex items-start gap-2">
                          <div className="text-xs font-bold text-gray-600 min-w-[60px]">
                            <CalendarIcon size={12} className="inline mr-1" />
                            {e.start_date.slice(5)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-800 truncate">{e.title}</div>
                            <div className="text-[10px] text-gray-500 truncate">
                              {e.assignees.join(" / ")}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {isIndividual && <span className="text-[9px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-semibold">個</span>}
                            {isMeeting && <span className="text-[9px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded font-semibold">M</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <footer className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-between items-center text-xs text-gray-600">
              <span>計 {drill.events.length} 件</span>
              <button
                onClick={() => router.push(`/${tenantId}`)}
                className="text-indigo-600 hover:text-indigo-700 font-semibold"
              >カレンダーで見る →</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

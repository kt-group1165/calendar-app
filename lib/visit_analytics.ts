/**
 * 福祉用具管理者: 訪問分析 用のクエリ群
 *
 * - fukuyogu_area_targets: エリア × 福祉用具事業所 × 目標頻度
 * - events から (origin office = 5 福祉用具事業所) かつ event_type が訪問関連 を集計
 *   個別訪問 / ミーティング時訪問 別カウント
 *   事業所別の前回訪問日
 */
import { supabase } from "./supabase";

// 5 福祉用具事業所 (= origin office としてカウント対象)
export const FUKUYOGU_OFFICE_IDS = [
  "e1b7b604-a4fd-44d5-98d1-efcb440ba035", // Ｈａｮｱ福祉用具花見川
  "ea7d88ea-5373-4054-8b6d-e8a11fbae217", // 千葉ムツミ福祉用具高品
  "bf2cbf8d-d4ca-4887-beae-a867d71a2b16", // Ｈａｮｱムツミ福祉用具 (誉田)
  "1bfc0d57-9ee0-4ae2-baa5-80edb776290a", // 介護ショップケア・サポート千葉
  "c3a5a2f7-a8f9-4d7a-81f5-3cf6a9c51f08", // リンクス福祉用具
] as const;

// 訪問種別 (event.event_type に含まれる文字列で判定)
export const EVENT_TYPE_INDIVIDUAL = "個別訪問";
export const EVENT_TYPE_MEETING = "ミーティング時訪問";

export type VisitTarget = {
  id: string;
  area_id: string;
  area_name: string;
  area_sort_order: number;
  office_id: string;
  office_name: string;
  office_short_name: string | null;
  target_frequency_days: number;
  notes: string | null;
};

export type VisitStats = {
  area_id: string;
  office_id: string;
  individual_count: number;   // 個別訪問 件数
  meeting_count: number;      // ミーティング時訪問 件数
  total_count: number;
  last_visit_date: string | null;        // YYYY-MM-DD
  last_visit_days_ago: number | null;     // 今日からの経過日数
};

export type MonthlyTrend = {
  area_id: string;
  office_id: string;
  yyyymm: string;             // "2026-05" 等
  individual_count: number;
  meeting_count: number;
};

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diffDays(from: string, to: Date): number {
  const f = new Date(from);
  return Math.floor((to.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * 全 visit_targets を join 済みの形で取得
 */
export async function getVisitTargets(): Promise<VisitTarget[]> {
  type RawTarget = { id: string; area_id: string; office_id: string; target_frequency_days: number; notes: string | null };
  const { data: targets, error } = await supabase
    .from("fukuyogu_area_targets")
    .select("id, area_id, office_id, target_frequency_days, notes");
  if (error) throw error;
  const tgts = ((targets ?? []) as RawTarget[]);
  if (tgts.length === 0) return [];

  const areaIds = [...new Set(tgts.map((t) => t.area_id))];
  const officeIds = [...new Set(tgts.map((t) => t.office_id))];

  const [areasRes, officesRes] = await Promise.all([
    supabase.from("event_areas").select("id, name, sort_order").in("id", areaIds),
    supabase.from("offices").select("id, name, short_name").in("id", officeIds),
  ]);

  const areaMap = new Map<string, { name: string; sort_order: number }>();
  for (const a of (areasRes.data ?? []) as { id: string; name: string; sort_order: number }[]) {
    areaMap.set(a.id, { name: a.name, sort_order: a.sort_order });
  }
  const officeMap = new Map<string, { name: string; short_name: string | null }>();
  for (const o of (officesRes.data ?? []) as { id: string; name: string; short_name: string | null }[]) {
    officeMap.set(o.id, { name: o.name, short_name: o.short_name });
  }

  return tgts.map((t) => {
    const a = areaMap.get(t.area_id);
    const o = officeMap.get(t.office_id);
    return {
      id: t.id,
      area_id: t.area_id,
      area_name: a?.name ?? "?",
      area_sort_order: a?.sort_order ?? 9999,
      office_id: t.office_id,
      office_name: o?.name ?? "?",
      office_short_name: o?.short_name ?? null,
      target_frequency_days: t.target_frequency_days,
      notes: t.notes ?? null,
    };
  });
}

/**
 * 指定月の (area × office) 訪問件数を集計
 * + 前回訪問日 (= 月をまたいで最新の訪問)
 */
export async function getVisitStats(year: number, month: number): Promise<Map<string, VisitStats>> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // last day of month
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ① 月内 events (count 用)
  const monthEventsRes = await supabase
    .from("events")
    .select("area_id, office_id, event_type")
    .in("office_id", FUKUYOGU_OFFICE_IDS as unknown as string[])
    .gte("start_date", fmtDate(monthStart))
    .lte("start_date", fmtDate(monthEnd))
    .is("deleted_at", null)
    .not("area_id", "is", null);
  if (monthEventsRes.error) throw monthEventsRes.error;

  // ② 全期間 events で最新訪問日 (前回訪問用)
  const lastEventsRes = await supabase
    .from("events")
    .select("area_id, office_id, start_date")
    .in("office_id", FUKUYOGU_OFFICE_IDS as unknown as string[])
    .lte("start_date", fmtDate(today))   // 今日以前
    .is("deleted_at", null)
    .not("area_id", "is", null)
    .order("start_date", { ascending: false });
  if (lastEventsRes.error) throw lastEventsRes.error;

  // 集計
  const stats = new Map<string, VisitStats>();
  const keyOf = (area: string, office: string) => `${area}:${office}`;

  for (const e of (monthEventsRes.data ?? []) as { area_id: string; office_id: string; event_type: string[] | null }[]) {
    const k = keyOf(e.area_id, e.office_id);
    if (!stats.has(k)) {
      stats.set(k, {
        area_id: e.area_id,
        office_id: e.office_id,
        individual_count: 0,
        meeting_count: 0,
        total_count: 0,
        last_visit_date: null,
        last_visit_days_ago: null,
      });
    }
    const s = stats.get(k)!;
    const types = e.event_type ?? [];
    const hasIndividual = types.some((t) => t.includes(EVENT_TYPE_INDIVIDUAL));
    const hasMeeting = types.some((t) => t.includes(EVENT_TYPE_MEETING));
    if (hasIndividual) s.individual_count += 1;
    if (hasMeeting) s.meeting_count += 1;
    s.total_count += 1;
  }

  // 最新訪問日 (events は desc order なので、未設定の key に値を入れる)
  for (const e of (lastEventsRes.data ?? []) as { area_id: string; office_id: string; start_date: string }[]) {
    const k = keyOf(e.area_id, e.office_id);
    if (!stats.has(k)) {
      stats.set(k, {
        area_id: e.area_id,
        office_id: e.office_id,
        individual_count: 0,
        meeting_count: 0,
        total_count: 0,
        last_visit_date: e.start_date,
        last_visit_days_ago: diffDays(e.start_date, today),
      });
    } else {
      const s = stats.get(k)!;
      if (s.last_visit_date === null) {
        s.last_visit_date = e.start_date;
        s.last_visit_days_ago = diffDays(e.start_date, today);
      }
    }
  }

  return stats;
}

/**
 * 指定期間 (年月の開始〜終了) の月別 trend を取得
 * 過去 N ヶ月の比較用
 */
export async function getMonthlyTrend(monthsBack: number = 6): Promise<Map<string, MonthlyTrend[]>> {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 1);
  const startStr = fmtDate(start);

  const { data, error } = await supabase
    .from("events")
    .select("area_id, office_id, event_type, start_date")
    .in("office_id", FUKUYOGU_OFFICE_IDS as unknown as string[])
    .gte("start_date", startStr)
    .is("deleted_at", null)
    .not("area_id", "is", null);
  if (error) throw error;

  // 集計: (area, office, yyyymm) → counts
  const map = new Map<string, MonthlyTrend>();
  for (const e of (data ?? []) as { area_id: string; office_id: string; event_type: string[] | null; start_date: string }[]) {
    const yyyymm = e.start_date.slice(0, 7); // YYYY-MM
    const k = `${e.area_id}:${e.office_id}:${yyyymm}`;
    if (!map.has(k)) {
      map.set(k, {
        area_id: e.area_id,
        office_id: e.office_id,
        yyyymm,
        individual_count: 0,
        meeting_count: 0,
      });
    }
    const t = map.get(k)!;
    const types = e.event_type ?? [];
    if (types.some((x) => x.includes(EVENT_TYPE_INDIVIDUAL))) t.individual_count += 1;
    if (types.some((x) => x.includes(EVENT_TYPE_MEETING))) t.meeting_count += 1;
  }

  // (area, office) → trend list (asc by yyyymm)
  const byPair = new Map<string, MonthlyTrend[]>();
  for (const t of map.values()) {
    const pairKey = `${t.area_id}:${t.office_id}`;
    if (!byPair.has(pairKey)) byPair.set(pairKey, []);
    byPair.get(pairKey)!.push(t);
  }
  for (const list of byPair.values()) {
    list.sort((a, b) => a.yyyymm.localeCompare(b.yyyymm));
  }
  return byPair;
}

/**
 * 月内の specific (area, office) events を ID + 詳細で取得 (ドリルダウン用)
 */
export async function getMonthVisitEvents(
  year: number,
  month: number,
  areaId: string,
  officeId: string,
): Promise<Array<{
  id: string;
  start_date: string;
  title: string;
  assignees: string[];
  event_type: string[];
}>> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const { data, error } = await supabase
    .from("events")
    .select("id, start_date, title, assignees, event_type")
    .eq("office_id", officeId)
    .eq("area_id", areaId)
    .gte("start_date", fmtDate(monthStart))
    .lte("start_date", fmtDate(monthEnd))
    .is("deleted_at", null)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    start_date: string;
    title: string;
    assignees: string[];
    event_type: string[];
  }>;
}

/**
 * 達成状況の色判定
 *   ✓ 緑: 経過 < 目標
 *   ⚠️ 黄: 目標 ≤ 経過 < 目標 × 1.5
 *   🚨 赤: 経過 ≥ 目標 × 1.5
 *   グレー: 一度も訪問なし
 */
export type Status = "good" | "warn" | "danger" | "none";

export function judgeStatus(daysAgo: number | null, targetDays: number): Status {
  if (daysAgo === null) return "none";
  if (daysAgo < targetDays) return "good";
  if (daysAgo < targetDays * 1.5) return "warn";
  return "danger";
}

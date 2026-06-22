/**
 * 福祉用具管理者: 訪問分析 用のクエリ群
 *
 * - fukuyogu_area_targets: エリア × 福祉用具事業所 × 目標頻度
 * - events から (origin office = 5 福祉用具事業所) かつ event_type が訪問関連 を集計
 *   個別訪問 / ミーティング時訪問 別カウント
 *   事業所別の前回訪問日
 */
import { supabase } from "./supabase";

// 福祉用具管理者 office (= 訪問予定が登録される origin office)
export const FUKUYOGU_KANRI_OFFICE_ID = "00cbb92e-b0c0-43f4-adcc-97d952c39548";

// 5 福祉用具事業所 (= 集計の「担当事業所」軸。assignee の primary office から特定)
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
export const EVENT_TYPE_OTHER = "その他";

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
  other_count: number;        // その他 件数
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
  other_count: number;
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
 * assignee name → primary office (= 5 福祉用具事業所のどれか) の map を構築
 */
async function getAssigneePrimaryOfficeMap(): Promise<Map<string, string>> {
  // members + member_offices (is_primary=true) を join
  const { data: members, error: memErr } = await supabase
    .from("members")
    .select("id, name");
  if (memErr) throw memErr;
  const memByName = new Map<string, string>();
  for (const m of (members ?? []) as { id: string; name: string }[]) {
    memByName.set(m.name, m.id);
  }

  // 5 福祉用具事業所のいずれかが primary な member_offices 行を取得
  const { data: moRows, error: moErr } = await supabase
    .from("member_offices")
    .select("member_id, office_id, is_primary")
    .in("office_id", FUKUYOGU_OFFICE_IDS as unknown as string[]);
  if (moErr) throw moErr;

  // assignee 名 → primary office_id (= 5 のうちのどれか)
  // primary を優先、無ければ最初の office を採用
  const memberIdToPrimary = new Map<string, string>();
  for (const r of (moRows ?? []) as { member_id: string; office_id: string; is_primary: boolean }[]) {
    if (r.is_primary) memberIdToPrimary.set(r.member_id, r.office_id);
  }
  for (const r of (moRows ?? []) as { member_id: string; office_id: string; is_primary: boolean }[]) {
    if (!memberIdToPrimary.has(r.member_id)) memberIdToPrimary.set(r.member_id, r.office_id);
  }

  const nameToPrimary = new Map<string, string>();
  for (const [name, memId] of memByName) {
    const office = memberIdToPrimary.get(memId);
    if (office) nameToPrimary.set(name, office);
  }
  return nameToPrimary;
}

/**
 * area_id → そのエリアに対応する office_id 群 (fukuyogu_area_targets から)
 * assignee 未指定 event のフォールバック用
 */
async function getAreaTargetsMap(): Promise<Map<string, string[]>> {
  type Row = { area_id: string; office_id: string };
  const { data, error } = await supabase
    .from("fukuyogu_area_targets")
    .select("area_id, office_id");
  if (error) throw error;
  const m = new Map<string, string[]>();
  for (const r of (data ?? []) as Row[]) {
    if (!m.has(r.area_id)) m.set(r.area_id, []);
    m.get(r.area_id)!.push(r.office_id);
  }
  return m;
}

/**
 * event の対応 office_id 群を返す:
 *   - エリアの target offices を candidates として取得
 *   - assignee の primary が candidates に含まれる → そのオフィスのみ
 *   - assignee の primary が含まれない or 空 → candidates 全部にフォールバック分配
 *     (= 対応事業所にない担当者の予定が「消える」事故を防ぐ)
 */
function resolveTargetOffices(
  e: { area_id: string; assignees: string[] | null | undefined },
  nameToPrimary: Map<string, string>,
  areaTargets: Map<string, string[]>,
): string[] {
  const candidates = areaTargets.get(e.area_id) ?? [];
  if (candidates.length === 0) return [];

  // assignee の primary が candidates にマッチするものだけ抽出
  const matched: string[] = [];
  for (const name of e.assignees ?? []) {
    const off = nameToPrimary.get(name);
    if (off && candidates.includes(off)) matched.push(off);
  }
  if (matched.length > 0) return [...new Set(matched)];

  // マッチなし (= 担当者未設定 or primary が対応事業所外) → 対応事業所全部
  return candidates;
}

/**
 * 指定月の (area × office) 訪問件数を集計
 * + 前回訪問日 (= 月をまたいで最新の訪問)
 *
 * 集計ロジック:
 *   - events の origin office = 福祉用具管理者
 *   - event_type に「個別訪問」or「ミーティング時訪問」を含む
 *   - area_id IS NOT NULL
 *   - assignee 有: 各 assignee の primary office でセル特定
 *   - assignee 空: area の target offices 全部に分配 (= 全該当セルに +1)
 *
 * includeDemo: デモ URL のみ true。本番 URL では未指定 (=false) で is_demo を除外。
 */
export async function getVisitStats(
  year: number,
  month: number,
  includeDemo: boolean = false,
): Promise<Map<string, VisitStats>> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [nameToPrimary, areaTargets] = await Promise.all([
    getAssigneePrimaryOfficeMap(),
    getAreaTargetsMap(),
  ]);

  // ① 月内 events
  let monthQ = supabase
    .from("events")
    .select("area_id, event_type, assignees")
    .eq("office_id", FUKUYOGU_KANRI_OFFICE_ID)
    .gte("start_date", fmtDate(monthStart))
    .lte("start_date", fmtDate(monthEnd))
    .is("deleted_at", null)
    .not("area_id", "is", null);
  if (!includeDemo) monthQ = monthQ.eq("is_demo", false);
  const monthEventsRes = await monthQ;
  if (monthEventsRes.error) throw monthEventsRes.error;

  // ② 全期間 events で最新訪問日 (前回訪問用)
  let lastQ = supabase
    .from("events")
    .select("area_id, event_type, assignees, start_date")
    .eq("office_id", FUKUYOGU_KANRI_OFFICE_ID)
    .lte("start_date", fmtDate(today))
    .is("deleted_at", null)
    .not("area_id", "is", null);
  if (!includeDemo) lastQ = lastQ.eq("is_demo", false);
  const lastEventsRes = await lastQ.order("start_date", { ascending: false });
  if (lastEventsRes.error) throw lastEventsRes.error;

  const stats = new Map<string, VisitStats>();
  const keyOf = (area: string, office: string) => `${area}:${office}`;

  // 月内カウント
  for (const e of (monthEventsRes.data ?? []) as { area_id: string; event_type: string[] | null; assignees: string[] }[]) {
    const types = e.event_type ?? [];
    const hasIndividual = types.some((t) => t.includes(EVENT_TYPE_INDIVIDUAL));
    const hasMeeting = types.some((t) => t.includes(EVENT_TYPE_MEETING));
    const hasOther = types.some((t) => t.includes(EVENT_TYPE_OTHER));
    if (!hasIndividual && !hasMeeting && !hasOther) continue;

    const offices = resolveTargetOffices(e, nameToPrimary, areaTargets);
    for (const officeId of offices) {
      const k = keyOf(e.area_id, officeId);
      if (!stats.has(k)) {
        stats.set(k, {
          area_id: e.area_id, office_id: officeId,
          individual_count: 0, meeting_count: 0, other_count: 0, total_count: 0,
          last_visit_date: null, last_visit_days_ago: null,
        });
      }
      const s = stats.get(k)!;
      if (hasIndividual) s.individual_count += 1;
      if (hasMeeting) s.meeting_count += 1;
      if (hasOther) s.other_count += 1;
      s.total_count += 1;
    }
  }

  // 最新訪問日 (events は desc order)
  for (const e of (lastEventsRes.data ?? []) as { area_id: string; event_type: string[] | null; assignees: string[]; start_date: string }[]) {
    const types = e.event_type ?? [];
    const hasIndividual = types.some((t) => t.includes(EVENT_TYPE_INDIVIDUAL));
    const hasMeeting = types.some((t) => t.includes(EVENT_TYPE_MEETING));
    const hasOther = types.some((t) => t.includes(EVENT_TYPE_OTHER));
    if (!hasIndividual && !hasMeeting && !hasOther) continue;

    const offices = resolveTargetOffices(e, nameToPrimary, areaTargets);
    for (const officeId of offices) {
      const k = keyOf(e.area_id, officeId);
      if (!stats.has(k)) {
        stats.set(k, {
          area_id: e.area_id, office_id: officeId,
          individual_count: 0, meeting_count: 0, other_count: 0, total_count: 0,
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
  }

  return stats;
}

/**
 * 指定期間 (年月の開始〜終了) の月別 trend を取得
 * 過去 N ヶ月の比較用
 *
 * includeDemo: デモ URL のみ true。本番 URL では未指定 (=false) で is_demo を除外。
 */
export async function getMonthlyTrend(
  monthsBack: number = 6,
  includeDemo: boolean = false,
): Promise<Map<string, MonthlyTrend[]>> {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 1);
  const startStr = fmtDate(start);

  const [nameToPrimary, areaTargets] = await Promise.all([
    getAssigneePrimaryOfficeMap(),
    getAreaTargetsMap(),
  ]);

  let q = supabase
    .from("events")
    .select("area_id, event_type, assignees, start_date")
    .eq("office_id", FUKUYOGU_KANRI_OFFICE_ID)
    .gte("start_date", startStr)
    .is("deleted_at", null)
    .not("area_id", "is", null);
  if (!includeDemo) q = q.eq("is_demo", false);
  const { data, error } = await q;
  if (error) throw error;

  // 集計: (area, office, yyyymm) → counts
  const map = new Map<string, MonthlyTrend>();
  for (const e of (data ?? []) as { area_id: string; event_type: string[] | null; assignees: string[]; start_date: string }[]) {
    const types = e.event_type ?? [];
    const hasIndividual = types.some((x) => x.includes(EVENT_TYPE_INDIVIDUAL));
    const hasMeeting = types.some((x) => x.includes(EVENT_TYPE_MEETING));
    const hasOther = types.some((x) => x.includes(EVENT_TYPE_OTHER));
    if (!hasIndividual && !hasMeeting && !hasOther) continue;
    const yyyymm = e.start_date.slice(0, 7);

    const offices = resolveTargetOffices(e, nameToPrimary, areaTargets);
    for (const officeId of offices) {
      const k = `${e.area_id}:${officeId}:${yyyymm}`;
      if (!map.has(k)) {
        map.set(k, {
          area_id: e.area_id, office_id: officeId, yyyymm,
          individual_count: 0, meeting_count: 0, other_count: 0,
        });
      }
      const t = map.get(k)!;
      if (hasIndividual) t.individual_count += 1;
      if (hasMeeting) t.meeting_count += 1;
      if (hasOther) t.other_count += 1;
    }
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
 *
 * includeDemo: デモ URL のみ true。本番 URL では未指定 (=false) で is_demo を除外。
 */
export async function getMonthVisitEvents(
  year: number,
  month: number,
  areaId: string,
  officeId: string,
  includeDemo: boolean = false,
): Promise<Array<{
  id: string;
  start_date: string;
  title: string;
  assignees: string[];
  event_type: string[];
}>> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  // origin = 福祉用具管理者、area 一致、event_type 訪問関連 で fetch
  // assignee の primary office or area target fallback で officeId 一致を client 側 filter
  const [nameToPrimary, areaTargets] = await Promise.all([
    getAssigneePrimaryOfficeMap(),
    getAreaTargetsMap(),
  ]);
  let q = supabase
    .from("events")
    .select("id, start_date, title, assignees, event_type")
    .eq("office_id", FUKUYOGU_KANRI_OFFICE_ID)
    .eq("area_id", areaId)
    .gte("start_date", fmtDate(monthStart))
    .lte("start_date", fmtDate(monthEnd))
    .is("deleted_at", null);
  if (!includeDemo) q = q.eq("is_demo", false);
  const { data, error } = await q.order("start_date", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<{
    id: string; start_date: string; title: string; assignees: string[]; event_type: string[];
  }>).filter((e) => {
    const types = e.event_type ?? [];
    if (!types.some((t) => t.includes(EVENT_TYPE_INDIVIDUAL) || t.includes(EVENT_TYPE_MEETING) || t.includes(EVENT_TYPE_OTHER))) return false;
    const offices = resolveTargetOffices({ area_id: areaId, assignees: e.assignees }, nameToPrimary, areaTargets);
    return offices.includes(officeId);
  });
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

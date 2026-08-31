import { supabase } from "./supabase";

export type EventType = {
  id: string;
  name: string;
  sort_order: number;
  office_id: string | null;
  hidden: boolean;
  created_at: string;
};

// officeId 指定時は更に絞り込む。office_id IS NULL の tenant 共通 type と
// 当該 office 専用 type の両方を返すため、`office_id.is.null,office_id.eq.<id>`
// の or 条件を使う (Phase 3c additive)
export async function getEventTypes(
  tenantId: string,
  opts?: { includeHidden?: boolean; officeId?: string },
): Promise<EventType[]> {
  let q = supabase
    .from("event_types")
    .select("*")
    .eq("tenant_id", tenantId);
  if (opts?.officeId) {
    q = q.or(`office_id.is.null,office_id.eq.${opts.officeId}`);
  }
  q = q.order("sort_order");
  if (!opts?.includeHidden) {
    q = q.eq("hidden", false);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function setEventTypeHidden(id: string, hidden: boolean): Promise<void> {
  const { error } = await supabase.from("event_types").update({ hidden }).eq("id", id);
  if (error) throw error;
}

export async function addEventType(name: string, tenantId: string, officeId: string | null = null): Promise<EventType> {
  const { data: last } = await supabase
    .from("event_types")
    .select("sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("event_types")
    .insert({ name, sort_order: (last?.sort_order ?? 0) + 1, tenant_id: tenantId, office_id: officeId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEventTypeOffice(id: string, officeId: string | null): Promise<void> {
  const { error } = await supabase.from("event_types").update({ office_id: officeId }).eq("id", id);
  if (error) throw error;
}

export async function deleteEventType(id: string): Promise<void> {
  const { error } = await supabase.from("event_types").delete().eq("id", id);
  if (error) throw error;
}

// 複数の種別を1つに統合する
//   targetName: 残す名前（canonical）
//   mergeNames: 削除する名前（統合元）
//   全予定の event_type 配列から mergeNames の名前を targetName に置換
//   重複した targetName は1つにまとめる
//   mergeNames の種別マスタを削除
// officeId 指定時は events 側の絞り込みにも適用 (Phase 3c additive)
export async function mergeEventTypes(
  tenantId: string,
  targetName: string,
  mergeIds: string[],
  mergeNames: string[],
  officeId?: string,
): Promise<{ updatedEvents: number; deletedTypes: number }> {
  // 該当する予定を全件取得（event_type配列に対象名のいずれかを含むもの）
  //
  // ⚠ **必ずページングすること。** PostgREST は 1 回 1000 行しか返さない。
  //   ここで打ち切ると 1000 件だけ書き換えたあとに下で種別マスタを DELETE するので、
  //   残った予定が「存在しない種別名」を持ったまま取り残される。しかも戻り値の
  //   updatedEvents も過少になるため、画面上は成功に見える (2026-08-31 是正)。
  const PAGE = 1000;
  const events: Array<{ id: string; event_type: string[] }> = [];
  for (let from = 0; ; from += PAGE) {
    let evQ = supabase
      .from("events")
      .select("id, event_type")
      .eq("tenant_id", tenantId)
      .overlaps("event_type", mergeNames);
    if (officeId) evQ = evQ.eq("office_id", officeId);
    const { data, error: evErr } = await evQ.order("id").range(from, from + PAGE - 1);
    if (evErr) throw evErr;
    events.push(...((data ?? []) as Array<{ id: string; event_type: string[] }>));
    if (!data || data.length < PAGE) break;
  }

  let updatedEvents = 0;
  for (const ev of events) {
    const newTypes = Array.from(
      new Set(
        ev.event_type.map((t) => (mergeNames.includes(t) ? targetName : t)),
      ),
    );
    const { error: upErr } = await supabase
      .from("events")
      .update({ event_type: newTypes })
      .eq("id", ev.id);
    if (upErr) throw upErr;
    updatedEvents++;
  }

  // マージ対象の種別マスタを削除
  const { error: delErr } = await supabase
    .from("event_types")
    .delete()
    .in("id", mergeIds);
  if (delErr) throw delErr;

  return { updatedEvents, deletedTypes: mergeIds.length };
}

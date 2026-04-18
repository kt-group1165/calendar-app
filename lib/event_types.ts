import { supabase } from "./supabase";

export type EventType = {
  id: string;
  name: string;
  sort_order: number;
  office_id: string | null;
  created_at: string;
};

export async function getEventTypes(tenantId: string): Promise<EventType[]> {
  const { data, error } = await supabase
    .from("event_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
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
export async function mergeEventTypes(
  tenantId: string,
  targetName: string,
  mergeIds: string[],
  mergeNames: string[],
): Promise<{ updatedEvents: number; deletedTypes: number }> {
  // 該当する予定を全件取得（event_type配列に対象名のいずれかを含むもの）
  const { data: events, error: evErr } = await supabase
    .from("events")
    .select("id, event_type")
    .eq("tenant_id", tenantId)
    .overlaps("event_type", mergeNames);
  if (evErr) throw evErr;

  let updatedEvents = 0;
  for (const ev of (events ?? []) as Array<{ id: string; event_type: string[] }>) {
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

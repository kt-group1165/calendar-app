import { supabase } from "./supabase";

export type EventArea = {
  id: string;
  tenant_id: string;
  office_id: string | null;
  name: string;
  sort_order: number;
  address_patterns: string[] | null;
  created_at: string;
};

// officeId 指定時は office_id IS NULL (tenant 共通) と当該 office の両方を返す (Phase 3c additive)
export async function getEventAreas(tenantId: string, officeId?: string): Promise<EventArea[]> {
  let q = supabase
    .from("event_areas")
    .select("*")
    .eq("tenant_id", tenantId);
  if (officeId) {
    q = q.or(`office_id.is.null,office_id.eq.${officeId}`);
  }
  const { data, error } = await q.order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addEventArea(
  tenantId: string,
  officeId: string | null,
  name: string,
): Promise<EventArea> {
  // sort_order: 同じ office_id 内で末尾
  const { data: last } = await supabase
    .from("event_areas")
    .select("sort_order")
    .eq("tenant_id", tenantId)
    .eq("office_id", officeId ?? null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("event_areas")
    .insert({
      tenant_id: tenantId,
      office_id: officeId,
      name,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEventArea(
  id: string,
  params: { name?: string; sort_order?: number; office_id?: string | null },
): Promise<void> {
  const { error } = await supabase.from("event_areas").update(params).eq("id", id);
  if (error) throw error;
}

export async function deleteEventArea(id: string): Promise<void> {
  const { error } = await supabase.from("event_areas").delete().eq("id", id);
  if (error) throw error;
}

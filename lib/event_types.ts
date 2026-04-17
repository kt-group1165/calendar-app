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

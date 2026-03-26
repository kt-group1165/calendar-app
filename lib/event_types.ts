import { supabase } from "./supabase";

export type EventType = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export async function getEventTypes(): Promise<EventType[]> {
  const { data, error } = await supabase
    .from("event_types")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function addEventType(name: string): Promise<EventType> {
  const { data: last } = await supabase
    .from("event_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("event_types")
    .insert({ name, sort_order: (last?.sort_order ?? 0) + 1 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEventType(id: string): Promise<void> {
  const { error } = await supabase.from("event_types").delete().eq("id", id);
  if (error) throw error;
}

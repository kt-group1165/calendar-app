import { supabase, type Event, type EventInsert, type EventUpdate } from "./supabase";

export async function getEvents(year: number, month: number): Promise<Event[]> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .or(`start_date.lte.${endDate},end_date.gte.${startDate}`)
    .order("start_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getEventsByDateRange(startDate: string, endDate: string): Promise<Event[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .or(`start_date.lte.${endDate},end_date.gte.${startDate}`)
    .order("start_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function createEvent(event: EventInsert): Promise<Event> {
  const { data, error } = await supabase
    .from("events")
    .insert(event)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateEvent(id: string, event: EventUpdate): Promise<Event> {
  const { data, error } = await supabase
    .from("events")
    .update(event)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadImage(file: File): Promise<string> {
  const ext = file.name.split(".").pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from("event-images")
    .upload(fileName, file, { contentType: file.type });

  if (error) throw error;

  const { data } = supabase.storage
    .from("event-images")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

export async function deleteImage(url: string): Promise<void> {
  const fileName = url.split("/").pop();
  if (!fileName) return;

  await supabase.storage.from("event-images").remove([fileName]);
}

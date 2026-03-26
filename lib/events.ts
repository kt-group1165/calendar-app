import { supabase, type Event, type EventInsert, type EventUpdate } from "./supabase";

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxWidth = 1280;
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const newName = file.name.replace(/\.[^.]+$/, ".webp");
            resolve(new File([blob], newName, { type: "image/webp" }));
          } else {
            resolve(file);
          }
        },
        "image/webp",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

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
  const compressed = await compressImage(file);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;

  const { error } = await supabase.storage
    .from("event-images")
    .upload(fileName, compressed, { contentType: "image/webp" });

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

// コメント機能
export type Comment = {
  id: string;
  event_id: string;
  author: string;
  body: string;
  created_at: string;
};

export async function getComments(eventId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function addComment(eventId: string, author: string, body: string): Promise<Comment> {
  const { data, error } = await supabase
    .from("comments")
    .insert({ event_id: eventId, author, body })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) throw error;
}

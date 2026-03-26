import { supabase, type Event, type EventInsert, type EventUpdate } from "./supabase";

// 画像圧縮（1280px・85%・WebP）
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
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// 予定取得（削除済み除く）
export async function getEventsByDateRange(startDate: string, endDate: string): Promise<Event[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .is("deleted_at", null)
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// 予定作成
export async function createEvent(event: EventInsert): Promise<Event> {
  const { data, error } = await supabase
    .from("events")
    .insert(event)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// 予定更新
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

// ソフトデリート（ゴミ箱へ）
export async function softDeleteEvent(id: string): Promise<void> {
  const { error } = await supabase
    .from("events")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// 復元
export async function restoreEvent(id: string): Promise<void> {
  const { error } = await supabase
    .from("events")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}

// 完全削除
export async function permanentDeleteEvent(id: string, imageUrl: string | null): Promise<void> {
  if (imageUrl) {
    try { await deleteImage(imageUrl); } catch {}
  }
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
}

// ゴミ箱内の予定取得
export async function getDeletedEvents(): Promise<Event[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// 10日以上経過した削除済みを自動完全削除
export async function cleanupOldDeletedEvents(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 10);
  const { data } = await supabase
    .from("events")
    .select("id, image_url")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff.toISOString());
  if (data && data.length > 0) {
    for (const event of data) {
      if (event.image_url) {
        try { await deleteImage(event.image_url); } catch {}
      }
    }
    await supabase.from("events").delete().in("id", data.map((e) => e.id));
  }
}

// 画像アップロード
export async function uploadImage(file: File): Promise<string> {
  const compressed = await compressImage(file);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
  const { error } = await supabase.storage
    .from("event-images")
    .upload(fileName, compressed, { contentType: "image/webp" });
  if (error) throw error;
  const { data } = supabase.storage.from("event-images").getPublicUrl(fileName);
  return data.publicUrl;
}

// 画像削除
export async function deleteImage(url: string): Promise<void> {
  const fileName = url.split("/").pop();
  if (!fileName) return;
  await supabase.storage.from("event-images").remove([fileName]);
}

// コメント
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

// ─── 活動ログ ───────────────────────────────────────────

export type ActivityLog = {
  id: string;
  event_id: string | null;
  event_title: string;
  action: "created" | "updated" | "deleted" | "comment_added";
  actor: string;
  assignees_before: string[];
  assignees_after: string[];
  created_at: string;
};

export async function logActivity(
  eventId: string,
  eventTitle: string,
  action: ActivityLog["action"],
  actor: string,
  assigneesBefore: string[] = [],
  assigneesAfter: string[] = []
): Promise<void> {
  try {
    await supabase.from("activity_logs").insert({
      event_id: eventId,
      event_title: eventTitle,
      action,
      actor,
      assignees_before: assigneesBefore,
      assignees_after: assigneesAfter,
    });
  } catch {
    // ログ失敗はサイレントに無視
  }
}

export async function getActivityLogs(
  limit: number,
  offset: number,
  userFilter?: string
): Promise<ActivityLog[]> {
  let query = supabase
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (userFilter) {
    query = query.or(
      `assignees_after.cs.{"${userFilter}"},assignees_before.cs.{"${userFilter}"}`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ActivityLog[];
}

export async function getUnreadActivityCount(since: string): Promise<number> {
  const { count, error } = await supabase
    .from("activity_logs")
    .select("*", { count: "exact", head: true })
    .gt("created_at", since);
  if (error) return 0;
  return count ?? 0;
}

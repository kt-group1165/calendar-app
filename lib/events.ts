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

// 全予定取得（削除済み除く・全期間・1000件超対応）
export async function getAllEvents(tenantId: string): Promise<Event[]> {
  const PAGE = 1000;
  const all: Event[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("start_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// 全テナントの全予定取得（バックアップ用）
export async function getAllEventsAllTenants(): Promise<Event[]> {
  const PAGE = 1000;
  const all: Event[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .is("deleted_at", null)
      .order("start_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// CSVインポート：バッチ処理版（500件まとめてupsert）
// syncMode=true の場合、CSV に無い既存予定をソフトデリート（ゴミ箱へ）
//   ID一致の予定は deleted_at=null で復活するため、バックアップCSV再取り込みで復元可能
// dateRange を指定すると、同期モードの削除対象を「期間内の予定のみ」に絞る（期間外は触らない）
export async function importEventsFromCSV(
  rows: Array<{ id?: string } & Partial<EventInsert>>,
  tenantId: string,
  onProgress?: (done: number, total: number) => void,
  syncMode: boolean = false,
  dateRange?: { startDate: string; endDate: string }
): Promise<{ updated: number; inserted: number; errors: number; deleted: number }> {
  const BATCH = 500;
  let updated = 0, inserted = 0, errors = 0, deleted = 0;
  const today = new Date().toISOString().slice(0, 10);
  const total = rows.length;

  // IDあり（既存更新）とIDなし（新規）に分ける
  // area_id は CSV にエリア列が無い場合 undefined なので、その場合は payload から除外して既存値を保持
  // deleted_at: null を設定することで、ゴミ箱内の予定を復活できる（ID一致時のみ）
  const toUpsert = rows
    .filter((r) => r.id)
    .map(({ id, ...data }) => {
      const base: Record<string, unknown> = {
        id,
        tenant_id: tenantId,
        title: data.title ?? "",
        description: data.description ?? null,
        notes: data.notes ?? null,
        start_date: data.start_date ?? today,
        end_date: data.end_date ?? today,
        start_time: data.start_time ?? null,
        end_time: data.end_time ?? null,
        all_day: data.all_day ?? false,
        color: data.color ?? "#6366f1",
        location: data.location ?? null,
        assignees: data.assignees ?? [],
        event_type: data.event_type ?? [],
        created_by: data.created_by ?? null,
        updated_by: data.updated_by ?? null,
        deleted_at: null,
      };
      if (data.area_id !== undefined) base.area_id = data.area_id;
      return base;
    });

  const toInsert = rows
    .filter((r) => !r.id)
    .map(({ id: _id, ...data }) => ({
      tenant_id: tenantId,
      title: data.title ?? "",
      description: data.description ?? null,
      notes: data.notes ?? null,
      start_date: data.start_date ?? today,
      end_date: data.end_date ?? today,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      all_day: data.all_day ?? false,
      color: data.color ?? "#6366f1",
      image_url: null,
      image_urls: [] as string[],
      location: data.location ?? null,
      assignees: data.assignees ?? [],
      event_type: data.event_type ?? [],
      area_id: data.area_id ?? null,
      created_by: data.created_by ?? null,
      updated_by: data.updated_by ?? null,
    }));

  // sync mode: 削除対象の事前スナップショット（upsert/insert の前に取得）
  //   insert で採番される新UUIDが誤って削除対象に入らないようにするため
  //   dateRange 指定時は期間内の予定のみを削除対象とする
  let toDelete: string[] = [];
  if (syncMode) {
    const csvIds = new Set(rows.filter((r) => r.id).map((r) => r.id!));
    let query = supabase
      .from("events")
      .select("id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    if (dateRange) {
      query = query
        .gte("start_date", dateRange.startDate)
        .lte("start_date", dateRange.endDate);
    }
    const { data: existingRows } = await query;
    const rowsTyped = (existingRows ?? []) as Array<{ id: string }>;
    toDelete = rowsTyped
      .filter((r) => !csvIds.has(r.id))
      .map((r) => r.id);
  }

  // upsert（IDあり）をバッチ処理
  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const batch = toUpsert.slice(i, i + BATCH);
    const { error } = await supabase
      .from("events")
      .upsert(batch, { onConflict: "id" });
    if (!error) updated += batch.length;
    else errors += batch.length;
    onProgress?.(updated + inserted + errors, total);
  }

  // insert（IDなし）をバッチ処理
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await supabase.from("events").insert(batch);
    if (!error) inserted += batch.length;
    else errors += batch.length;
    onProgress?.(updated + inserted + errors, total);
  }

  // sync mode: 事前スナップショットで算出した削除対象をソフトデリート
  if (syncMode) {
    const nowIso = new Date().toISOString();
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const batch = toDelete.slice(i, i + BATCH);
      const { error } = await supabase
        .from("events")
        .update({ deleted_at: nowIso })
        .in("id", batch);
      if (!error) deleted += batch.length;
    }
  }

  return { updated, inserted, errors, deleted };
}

// 予定取得（削除済み・メモ除く）
export async function getEventsByDateRange(startDate: string, endDate: string, tenantId: string): Promise<Event[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .eq("is_memo", false)
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// メモ一覧取得（日付未定の予定）・ページング対応
export async function getMemoEvents(tenantId: string): Promise<Event[]> {
  const PAGE = 1000;
  const all: Event[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .eq("is_memo", true)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// 予定1件取得（削除済み含む）
export async function getEventById(id: string): Promise<Event | null> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// 予定作成
export async function createEvent(event: EventInsert, tenantId: string): Promise<Event> {
  const { data, error } = await supabase
    .from("events")
    .insert({ ...event, tenant_id: tenantId })
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

// ゴミ箱内の予定取得・ページング対応
export async function getDeletedEvents(tenantId: string): Promise<Event[]> {
  const PAGE = 1000;
  const all: Event[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("tenant_id", tenantId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// 10日以上経過した削除済みを自動完全削除
export async function cleanupOldDeletedEvents(tenantId: string): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 10);
  const { data } = await supabase
    .from("events")
    .select("id, image_url, image_urls")
    .eq("tenant_id", tenantId)
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff.toISOString());
  type DeletableRow = { id: string; image_url: string | null; image_urls: string[] | null };
  const rows = (data ?? []) as DeletableRow[];
  if (rows.length > 0) {
    const ids = rows.map((e) => e.id);
    const { error } = await supabase.from("events").delete().in("id", ids);
    if (!error) {
      for (const event of rows) {
        const urls: string[] = event.image_urls?.length
          ? event.image_urls
          : event.image_url ? [event.image_url] : [];
        for (const url of urls) {
          try { await deleteImage(url); } catch {}
        }
      }
    }
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
  assigneesAfter: string[] = [],
  tenantId: string = "default"
): Promise<void> {
  try {
    await supabase.from("activity_logs").insert({
      event_id: eventId,
      event_title: eventTitle,
      action,
      actor,
      assignees_before: assigneesBefore,
      assignees_after: assigneesAfter,
      tenant_id: tenantId,
    });
  } catch {
    // ログ失敗はサイレントに無視
  }
}

export async function getActivityLogs(
  limit: number,
  offset: number,
  userFilter?: string,
  tenantId: string = "default"
): Promise<ActivityLog[]> {
  let query = supabase
    .from("activity_logs")
    .select("*")
    .eq("tenant_id", tenantId)
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

export async function getUnreadActivityCount(since: string, tenantId: string = "default"): Promise<number> {
  const { count, error } = await supabase
    .from("activity_logs")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gt("created_at", since);
  if (error) return 0;
  return count ?? 0;
}

export async function searchEventsByTitle(query: string, tenantId: string): Promise<Event[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("tenant_id", tenantId)
    .ilike("title", `%${query}%`)
    .is("deleted_at", null)
    .order("start_date", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

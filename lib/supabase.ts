// 既存コード互換のための re-export。
// 新規コードでは lib/supabase-browser.ts / lib/supabase-server.ts を直接使うこと。
import { getSupabase } from "./supabase-browser";

export const supabase = getSupabase();

export type Event = {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  all_day: boolean;
  is_memo: boolean;
  image_url: string | null;
  image_urls: string[];
  location: string | null;
  notes: string | null;
  assignees: string[];
  event_type: string[];
  office_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EventInsert = Omit<Event, "id" | "created_at" | "updated_at" | "deleted_at">;
export type EventUpdate = Partial<EventInsert>;

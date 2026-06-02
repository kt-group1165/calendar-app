import { supabase } from "./supabase";

export type Office = {
  id: string;
  tenant_id: string;
  name: string;
  /** Phase 9-5d: cross-office タイトルマスク時の短縮名 (例: 「高品用具」→「高品用具案件」表示) */
  short_name: string | null;
  business_number: string | null;
  service_type: string | null;
  sort_order: number;
  created_at: string;
};

// calendar-app は 福祉用具 + 本社 のスタッフが使うので両方取得
export const CALENDAR_SERVICE_TYPES = ["福祉用具", "本社"] as const;

export async function getOffices(tenantId: string): Promise<Office[]> {
  const { data, error } = await supabase
    .from("offices")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("service_type", CALENDAR_SERVICE_TYPES as unknown as string[])
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

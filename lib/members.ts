import { supabase } from "./supabase";

export type Member = {
  id: string;
  name: string;
  color: string;
  sort_order: number | null;
  office_id: string | null;
  created_at: string;
};

export async function updateMemberOffice(id: string, officeId: string | null): Promise<void> {
  const { error } = await supabase.from("members").update({ office_id: officeId }).eq("id", id);
  if (error) throw error;
}

// officeId 指定時は更に office_id でも絞り込む (Phase 3c additive)
export async function getMembers(tenantId: string, officeId?: string): Promise<Member[]> {
  let q = supabase
    .from("members")
    .select("*")
    .eq("tenant_id", tenantId);
  if (officeId) q = q.eq("office_id", officeId);
  const { data, error } = await q
    .order("sort_order", { nullsFirst: false })
    .order("name");
  if (error) throw error;
  return data ?? [];
}

// officeId 指定時は INSERT 時の office_id にも反映 (Phase 3c additive)
export async function addMember(
  name: string,
  color: string = "#6366f1",
  tenantId: string,
  officeId?: string,
): Promise<Member> {
  let existingQuery = supabase
    .from("members")
    .select("sort_order")
    .eq("tenant_id", tenantId);
  if (officeId) existingQuery = existingQuery.eq("office_id", officeId);
  const { data: existing } = await existingQuery
    .order("sort_order", { ascending: false })
    .limit(1);
  const maxOrder = existing?.[0]?.sort_order ?? 0;

  const insertPayload: { name: string; color: string; sort_order: number; tenant_id: string; office_id?: string } = {
    name,
    color,
    sort_order: maxOrder + 1,
    tenant_id: tenantId,
  };
  if (officeId) insertPayload.office_id = officeId;

  const { data, error } = await supabase
    .from("members")
    .insert(insertPayload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMemberColor(id: string, color: string): Promise<void> {
  const { error } = await supabase.from("members").update({ color }).eq("id", id);
  if (error) throw error;
}

export async function updateMemberOrder(id: string, sort_order: number): Promise<void> {
  const { error } = await supabase.from("members").update({ sort_order }).eq("id", id);
  if (error) throw error;
}

export async function deleteMember(id: string): Promise<void> {
  const { error } = await supabase.from("members").delete().eq("id", id);
  if (error) throw error;
}

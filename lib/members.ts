import { supabase } from "./supabase";

export type Member = {
  id: string;
  name: string;
  color: string;
  sort_order: number | null;
  created_at: string;
};

export async function getMembers(tenantId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { nullsFirst: false })
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function addMember(name: string, color: string = "#6366f1", tenantId: string): Promise<Member> {
  const { data: existing } = await supabase
    .from("members")
    .select("sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const maxOrder = existing?.[0]?.sort_order ?? 0;

  const { data, error } = await supabase
    .from("members")
    .insert({ name, color, sort_order: maxOrder + 1, tenant_id: tenantId })
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

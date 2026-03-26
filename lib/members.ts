import { supabase } from "./supabase";

export type Member = {
  id: string;
  name: string;
  color: string;
  created_at: string;
};

export async function getMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function addMember(name: string, color: string = "#6366f1"): Promise<Member> {
  const { data, error } = await supabase
    .from("members")
    .insert({ name, color })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMemberColor(id: string, color: string): Promise<void> {
  const { error } = await supabase.from("members").update({ color }).eq("id", id);
  if (error) throw error;
}

export async function deleteMember(id: string): Promise<void> {
  const { error } = await supabase.from("members").delete().eq("id", id);
  if (error) throw error;
}

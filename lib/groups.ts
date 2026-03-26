import { supabase } from "./supabase";

export type MemberGroup = {
  id: string;
  name: string;
  member_names: string[];
  created_at: string;
};

export async function getGroups(): Promise<MemberGroup[]> {
  const { data, error } = await supabase
    .from("member_groups")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addGroup(name: string, memberNames: string[]): Promise<MemberGroup> {
  const { data, error } = await supabase
    .from("member_groups")
    .insert({ name, member_names: memberNames })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateGroup(id: string, name: string, memberNames: string[]): Promise<void> {
  const { error } = await supabase
    .from("member_groups")
    .update({ name, member_names: memberNames })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteGroup(id: string): Promise<void> {
  const { error } = await supabase
    .from("member_groups")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

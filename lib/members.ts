import { supabase } from "./supabase";

export type Member = {
  id: string;
  name: string;
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

export async function addMember(name: string): Promise<Member> {
  const { data, error } = await supabase
    .from("members")
    .insert({ name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMember(id: string): Promise<void> {
  const { error } = await supabase.from("members").delete().eq("id", id);
  if (error) throw error;
}

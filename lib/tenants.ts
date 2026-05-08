import { supabase } from "./supabase";

export type Tenant = {
  id: string;
  name: string;
  tenant_type: "group" | "role" | "office" | "test" | null;
  created_at: string;
};

export async function getTenants(): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, tenant_type, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addTenant(id: string, name: string): Promise<Tenant> {
  const { data, error } = await supabase
    .from("tenants")
    .insert({ id, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTenant(id: string): Promise<void> {
  const { error } = await supabase.from("tenants").delete().eq("id", id);
  if (error) throw error;
}

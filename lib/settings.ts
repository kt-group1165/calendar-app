import { supabase } from "./supabase";

export async function verifyMasterPin(pin: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "master_pin")
    .single();
  if (error) return false;
  return data.value === pin;
}

export async function updateMasterPin(newPin: string): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key: "master_pin", value: newPin });
  if (error) throw error;
}

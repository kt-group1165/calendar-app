import { supabase } from "./supabase";

export async function verifyMasterPin(pin: string, tenantId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "master_pin")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return false;
  return data.value === pin;
}

export async function updateMasterPin(newPin: string, tenantId: string): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key: "master_pin", tenant_id: tenantId, value: newPin }, { onConflict: "key,tenant_id" });
  if (error) throw error;
}

// ── 利用者選択機能 ────────────────────────────────────

export async function getClientSelectionEnabled(tenantId: string): Promise<boolean> {
  const val = await getSetting("client_selection_enabled", tenantId);
  return val !== "false"; // デフォルトON
}

export async function updateClientSelectionEnabled(tenantId: string, enabled: boolean): Promise<void> {
  await setSetting("client_selection_enabled", enabled ? "true" : "false", tenantId);
}

// ── 発注メール設定 ─────────────────────────────────────

export type OrderEmailSettings = {
  enabled: boolean;
  to: string;
  from: string;
};

async function getSetting(key: string, tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data?.value ?? null;
}

async function setSetting(key: string, value: string, tenantId: string): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key, tenant_id: tenantId, value }, { onConflict: "key,tenant_id" });
  if (error) throw error;
}

export async function getOrderEmailSettings(tenantId: string): Promise<OrderEmailSettings> {
  const [enabled, to, from] = await Promise.all([
    getSetting("order_email_enabled", tenantId),
    getSetting("order_email_to", tenantId),
    getSetting("order_email_from", tenantId),
  ]);
  return {
    enabled: enabled === "true",
    to: to ?? "",
    from: from ?? "onboarding@resend.dev",
  };
}

export async function updateOrderEmailSettings(tenantId: string, settings: OrderEmailSettings): Promise<void> {
  await Promise.all([
    setSetting("order_email_enabled", settings.enabled ? "true" : "false", tenantId),
    setSetting("order_email_to", settings.to, tenantId),
    setSetting("order_email_from", settings.from, tenantId),
  ]);
}

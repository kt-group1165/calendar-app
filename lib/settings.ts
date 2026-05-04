import { supabase } from "./supabase";

// Phase 2-7 で master_pin / verifyMasterPin / updateMasterPin は廃止。
// master 判定は user_groups / user_companies / user_offices による RLS に統一。
// 旧 settings.master_pin 行は DB に残るが参照されないので無害（必要なら別途
// migration で DELETE FROM settings WHERE key = 'master_pin'; を実行）。

// ── 利用者選択機能 ────────────────────────────────────

export async function getClientSelectionEnabled(tenantId: string): Promise<boolean> {
  const val = await getSetting("client_selection_enabled", tenantId);
  return val !== "false"; // デフォルトON
}

export async function updateClientSelectionEnabled(tenantId: string, enabled: boolean): Promise<void> {
  await setSetting("client_selection_enabled", enabled ? "true" : "false", tenantId);
}

// ── メモ欄プリセット ───────────────────────────────────
// 新規予定作成時に description（メモ）欄に初期テキストを挿入する機能。
// テナント単位でON/OFF＋本文を保持。既存予定の編集時には挿入しない。

export type MemoPreset = {
  enabled: boolean;
  text: string;
};

export async function getMemoPreset(tenantId: string): Promise<MemoPreset> {
  const [enabled, text] = await Promise.all([
    getSetting("event_memo_preset_enabled", tenantId),
    getSetting("event_memo_preset_text", tenantId),
  ]);
  return {
    enabled: enabled === "true",
    text: text ?? "",
  };
}

export async function updateMemoPreset(tenantId: string, preset: MemoPreset): Promise<void> {
  await Promise.all([
    setSetting("event_memo_preset_enabled", preset.enabled ? "true" : "false", tenantId),
    setSetting("event_memo_preset_text", preset.text, tenantId),
  ]);
}

// ── 訪問種別 必須化 ─────────────────────────────────────
// 予定作成・編集時に「ミーティング時訪問 / 個別訪問 / その他」の3択選択を
// 必須にする機能。テナント単位でON/OFF。
// 値は events.visit_type に保存。

export const VISIT_TYPE_OPTIONS = [
  "ミーティング時訪問",
  "個別訪問",
  "その他",
] as const;
export type VisitType = (typeof VISIT_TYPE_OPTIONS)[number];

export async function getVisitTypeRequired(tenantId: string): Promise<boolean> {
  const val = await getSetting("visit_type_required_enabled", tenantId);
  return val === "true";
}

export async function updateVisitTypeRequired(tenantId: string, enabled: boolean): Promise<void> {
  await setSetting("visit_type_required_enabled", enabled ? "true" : "false", tenantId);
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

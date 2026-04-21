import { supabase } from "./supabase";

export type Client = {
  id: string;
  user_number: string;
  name: string;
  furigana: string | null;
  address: string | null;
  postal_code: string | null;
  phone: string | null;
  mobile: string | null;
  memo: string | null;
  benefit_rate: string | null;
  care_level: string | null;
  care_manager_org: string | null;
  care_manager: string | null;
  certification_end_date: string | null;
  office_id: string | null;
  is_facility?: boolean;
  // 仮登録（カレンダー上で自由入力された利用者。発注システムで本登録されたら false になる）
  is_provisional?: boolean;
  created_at: string;
  updated_at: string;
};

// カレンダー画面から新規利用者を自由入力で仮登録する。
//   - 発注システム側にも同じ clients 行として共有される
//   - is_provisional=true で印を付け、後で本登録時に外す
//   - user_number は null のまま（本登録時に確定）
export async function createProvisionalClient(
  tenantId: string,
  name: string,
  address: string | null,
): Promise<Client> {
  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    name: name.trim(),
    address: address?.trim() || null,
    is_provisional: true,
  };
  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as Client;
}

export async function updateClientOffice(id: string, officeId: string | null): Promise<void> {
  // 後方互換: clients.office_id も更新（カレンダー旧仕様）
  const { error } = await supabase.from("clients").update({ office_id: officeId }).eq("id", id);
  if (error) throw error;
}

// ── kaigo-app と共有する client_office_assignments 関連 ──
// kaigo-app が使用する多対多の事業所紐付けテーブル。
// calendar-app もこちらを優先して参照する。
export type ClientOfficeAssignment = {
  tenant_id: string;
  client_id: string;
  office_id: string;
  created_at?: string;
};

export async function getClientOfficeAssignments(tenantId: string): Promise<ClientOfficeAssignment[]> {
  const { data, error } = await supabase
    .from("client_office_assignments")
    .select("*")
    .eq("tenant_id", tenantId);
  if (error) throw error;
  return (data as ClientOfficeAssignment[]) ?? [];
}

// 指定利用者の紐付け事業所を設定（既存は置換）
export async function setClientOfficeAssignment(
  tenantId: string,
  clientId: string,
  officeId: string | null,
): Promise<void> {
  // まず既存紐付けを削除
  await supabase
    .from("client_office_assignments")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId);
  // officeId が指定されていれば追加（null = 共有扱い）
  if (officeId) {
    const { error } = await supabase
      .from("client_office_assignments")
      .insert({ tenant_id: tenantId, client_id: clientId, office_id: officeId });
    if (error) throw error;
  }
}

export type ClientInsert = Omit<Client, "id" | "created_at" | "updated_at">;

// 利用者取得（全件・ページング）
export async function getClients(tenantId: string): Promise<Client[]> {
  const PAGE = 1000;
  const all: Client[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("furigana", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function replaceAllClients(clients: ClientInsert[], tenantId: string): Promise<void> {
  // テナントの全件削除
  await supabase.from("clients").delete().eq("tenant_id", tenantId);
  // バッチ挿入（500件ずつ）
  const BATCH = 500;
  for (let i = 0; i < clients.length; i += BATCH) {
    const batch = clients.slice(i, i + BATCH).map((c) => ({ ...c, tenant_id: tenantId }));
    const { error } = await supabase.from("clients").insert(batch);
    if (error) throw error;
  }
}

// 指定した事業所スコープの利用者のみを置換する（他事業所データは保持）
//   officeId = null  → 共有（client_office_assignments 未紐付け）のみ置換
//   officeId = "..." → その事業所に紐付いた利用者のみ置換し、新規利用者も同事業所に紐付ける
export async function replaceClientsForOffice(
  clients: ClientInsert[],
  tenantId: string,
  officeId: string | null,
): Promise<void> {
  if (officeId === null) {
    // 共有スコープ: 事業所紐付けがない利用者のみを対象に置換
    const assignments = await getClientOfficeAssignments(tenantId);
    const assignedIds = new Set(assignments.map((a) => a.client_id));
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantId);
    const idsToDelete = (existing ?? [])
      .map((c: { id: string }) => c.id)
      .filter((id: string) => !assignedIds.has(id));
    if (idsToDelete.length > 0) {
      await supabase.from("clients").delete().in("id", idsToDelete);
    }
  } else {
    // 特定事業所スコープ: その事業所に紐付いた利用者だけ削除
    const { data: assignments } = await supabase
      .from("client_office_assignments")
      .select("client_id")
      .eq("tenant_id", tenantId)
      .eq("office_id", officeId);
    const idsToDelete = (assignments ?? []).map((a: { client_id: string }) => a.client_id);
    if (idsToDelete.length > 0) {
      // client_office_assignments は clients 削除で CASCADE されるので clients のみ削除
      await supabase.from("clients").delete().in("id", idsToDelete);
    }
  }

  // バッチ挿入
  const BATCH = 500;
  const insertedIds: string[] = [];
  for (let i = 0; i < clients.length; i += BATCH) {
    const batch = clients.slice(i, i + BATCH).map((c) => ({
      ...c,
      tenant_id: tenantId,
      office_id: officeId, // 後方互換
    }));
    const { data, error } = await supabase.from("clients").insert(batch).select("id");
    if (error) throw error;
    (data ?? []).forEach((r: { id: string }) => insertedIds.push(r.id));
  }

  // 事業所紐付け（officeId指定時のみ）
  if (officeId && insertedIds.length > 0) {
    const assignments = insertedIds.map((id) => ({
      tenant_id: tenantId,
      client_id: id,
      office_id: officeId,
    }));
    for (let i = 0; i < assignments.length; i += BATCH) {
      const batch = assignments.slice(i, i + BATCH);
      const { error } = await supabase.from("client_office_assignments").insert(batch);
      if (error) throw error;
    }
  }
}

// CSV（Shift-JIS）をパースして ClientInsert[] に変換
export async function parseClientCSV(file: File): Promise<ClientInsert[]> {
  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder("shift-jis");
  const text = decoder.decode(buffer);

  function parseRow(line: string): string[] {
    const result: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(field); field = "";
      } else {
        field += ch;
      }
    }
    result.push(field);
    return result;
  }

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseRow(lines[0]);

  const userMap = new Map<string, Record<string, string>>();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseRow(lines[i]);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { rec[h] = vals[idx]?.trim() ?? ""; });

    const num = rec["利用者番号"];
    if (!num) continue;

    const existing = userMap.get(num);
    const newEnd = rec["認定有効期間－終了日"] ?? "";
    const oldEnd = existing?.["認定有効期間－終了日"] ?? "";

    if (!existing || newEnd > oldEnd) {
      userMap.set(num, rec);
    }
  }

  const n = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);

  return Array.from(userMap.values())
    .filter((r) => r["利用者番号"] && r["利用者名"])
    .map((r) => ({
      user_number: r["利用者番号"],
      name: r["利用者名"] || `${r["利用者名（姓）"] ?? ""} ${r["利用者名（名）"] ?? ""}`.trim(),
      furigana: n(r["フリガナ"]),
      address: n(r["住所"]),
      postal_code: n(r["郵便番号"]),
      phone: n(r["電話番号"]),
      mobile: n(r["携帯番号"]),
      memo: n(r["メモ"]),
      benefit_rate: n(r["給付率"]),
      care_level: n(r["要介護度"]),
      care_manager_org: n(r["支援事業所（正式名称）"]),
      care_manager: n(r["担当ケアマネジャー"]),
      certification_end_date: n(r["認定有効期間－終了日"]),
      office_id: null,
    }));
}

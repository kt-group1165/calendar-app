import { getMaxUserNumber } from "@kt/shared/user-number";
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
  // ソフト削除日時（null なら未削除）
  deleted_at?: string | null;
  // 居宅マスタ FK（発注システム側で管理。なければ care_manager_org テキスト）
  care_office_id?: string | null;
  created_at: string;
  updated_at: string;
};

// カレンダー画面から新規利用者を自由入力で仮登録する。
//   - 発注システム側にも同じ clients 行として共有される
//   - is_provisional=true で印を付け、後で本登録時に外す
//   - user_number は NOT NULL 制約があるため、テナント内の最大値+1 を採番（@kt/shared 共通 util）
//   - unique 制約衝突時は自動で +1 してリトライ（並行挿入対策）
// officeId 指定時は clients.office_id にも反映 (Phase 3c additive)
export async function createProvisionalClient(
  tenantId: string,
  name: string,
  address: string | null,
  phone?: string | null,
  careOfficeId?: string | null,
  careOfficeName?: string | null,
  officeId?: string,
): Promise<Client> {
  let candidate = (await getMaxUserNumber(supabase, tenantId)) + 1;
  const MAX_RETRY = 10;

  for (let i = 0; i < MAX_RETRY; i++) {
    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      user_number: String(candidate),
      name: name.trim(),
      address: address?.trim() || null,
      phone: phone?.trim() || null,
      care_office_id: careOfficeId || null,
      care_manager_org: careOfficeName || null,
      is_provisional: true,
    };
    if (officeId) payload.office_id = officeId;
    const { data, error } = await supabase
      .from("clients")
      .insert(payload)
      .select()
      .single();
    if (!error) return data as Client;
    // 23505 = unique_violation: 採番衝突なら +1 してリトライ
    if ((error as { code?: string }).code === "23505") {
      candidate += 1;
      continue;
    }
    throw error;
  }
  throw new Error(`user_number の採番に失敗しました（${MAX_RETRY}回リトライ）`);
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
  // PostgREST default 1000 行制限対応: ページング取得
  const PAGE = 1000;
  const all: ClientOfficeAssignment[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("client_office_assignments")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as ClientOfficeAssignment[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
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

// テナント単位のメモを client_memos から取得して Map<client_id, body> で返す
// scope='tenant' の最新（updated_at desc）1 件のみ採用
async function fetchTenantMemos(tenantId: string): Promise<Map<string, string>> {
  const PAGE = 1000;
  const map = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("client_memos")
      .select("client_id, body, updated_at")
      .eq("tenant_id", tenantId)
      .eq("scope", "tenant")
      .order("updated_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as { client_id: string; body: string; updated_at: string }[]) {
      // 最新 (desc 順なので最初に出現したもの) のみ保持
      if (!map.has(row.client_id)) map.set(row.client_id, row.body);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// 利用者取得（全件・ページング）
// 削除済み（deleted_at IS NOT NULL）は除外
// memo は廃止予定の clients.memo カラムではなく client_memos テーブルから取得
// officeId 指定時は clients.office_id で絞り込む。client_office_assignments
// による多対多紐付けはここでは見ない (kaigo-app 専用フローなので)。
// (Phase 3c additive)
export async function getClients(tenantId: string, officeId?: string): Promise<Client[]> {
  const PAGE = 1000;
  const all: Client[] = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from("clients")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    if (officeId) q = q.eq("office_id", officeId);
    const { data, error } = await q
      .order("furigana", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  // memo を client_memos から merge
  const memoMap = await fetchTenantMemos(tenantId);
  for (const c of all) {
    c.memo = memoMap.get(c.id) ?? null;
  }
  return all;
}

// memo upsert（既存 tenant メモがあれば UPDATE、なければ INSERT）
// body が空文字 / null の場合は削除
export async function upsertClientMemo(
  clientId: string,
  tenantId: string,
  body: string | null,
): Promise<void> {
  const trimmed = body?.trim() || null;
  // 既存の tenant スコープメモを検索
  const { data: existing } = await supabase
    .from("client_memos")
    .select("id")
    .eq("client_id", clientId)
    .eq("tenant_id", tenantId)
    .eq("scope", "tenant")
    .order("updated_at", { ascending: false })
    .limit(1);
  const existingId = existing?.[0]?.id as string | undefined;

  if (!trimmed) {
    // 空文字 / null → 削除
    if (existingId) {
      const { error } = await supabase.from("client_memos").delete().eq("id", existingId);
      if (error) throw error;
    }
    return;
  }
  if (existingId) {
    const { error } = await supabase
      .from("client_memos")
      .update({ body: trimmed })
      .eq("id", existingId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("client_memos").insert({
      client_id: clientId,
      tenant_id: tenantId,
      scope: "tenant",
      body: trimmed,
    });
    if (error) throw error;
  }
}

// バッチ insert 後に memo を client_memos へ書き戻すヘルパー
// CSV 由来の ClientInsert.memo を user_number でキーにして対応付け
async function bulkInsertTenantMemos(
  tenantId: string,
  inserted: { id: string; user_number: string }[],
  source: ClientInsert[],
): Promise<void> {
  const userNumToMemo = new Map<string, string>();
  for (const c of source) {
    const m = (c.memo ?? "").trim();
    if (m) userNumToMemo.set(c.user_number, m);
  }
  if (userNumToMemo.size === 0) return;

  const memoRows = inserted
    .map((row) => {
      const body = userNumToMemo.get(row.user_number);
      return body
        ? { client_id: row.id, tenant_id: tenantId, scope: "tenant", body }
        : null;
    })
    .filter((r): r is { client_id: string; tenant_id: string; scope: string; body: string } => r !== null);

  const BATCH = 500;
  for (let i = 0; i < memoRows.length; i += BATCH) {
    const { error } = await supabase
      .from("client_memos")
      .insert(memoRows.slice(i, i + BATCH));
    if (error) throw error;
  }
}

export async function replaceAllClients(clients: ClientInsert[], tenantId: string): Promise<void> {
  // テナントの全件削除（client_memos は CASCADE で連動削除される）
  await supabase.from("clients").delete().eq("tenant_id", tenantId);
  // バッチ挿入（500件ずつ）。memo は clients ではなく client_memos へ書き戻す
  const BATCH = 500;
  const insertedAll: { id: string; user_number: string }[] = [];
  for (let i = 0; i < clients.length; i += BATCH) {
    const batch = clients.slice(i, i + BATCH).map((c) => {
      // memo を剥がして clients INSERT 用 payload に整形
      const { memo: _memo, ...rest } = c;
      void _memo;
      return { ...rest, tenant_id: tenantId };
    });
    const { data, error } = await supabase
      .from("clients")
      .insert(batch)
      .select("id, user_number");
    if (error) throw error;
    insertedAll.push(...((data ?? []) as { id: string; user_number: string }[]));
  }
  // memo を client_memos へ書き戻す
  await bulkInsertTenantMemos(tenantId, insertedAll, clients);
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
    // PostgREST default 1000 行制限対応: ページング取得
    const allExisting: { id: string }[] = [];
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("clients")
          .select("id")
          .eq("tenant_id", tenantId)
          .order("id").range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        allExisting.push(...(data as { id: string }[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }
    const idsToDelete = allExisting
      .map((c) => c.id)
      .filter((id) => !assignedIds.has(id));
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

  // バッチ挿入（memo は clients ではなく client_memos へ書き戻す）
  const BATCH = 500;
  const insertedIds: string[] = [];
  const insertedAll: { id: string; user_number: string }[] = [];
  for (let i = 0; i < clients.length; i += BATCH) {
    const batch = clients.slice(i, i + BATCH).map((c) => {
      // memo を剥がして clients INSERT 用 payload に整形
      const { memo: _memo, ...rest } = c;
      void _memo;
      return {
        ...rest,
        tenant_id: tenantId,
        office_id: officeId, // 後方互換
      };
    });
    const { data, error } = await supabase
      .from("clients")
      .insert(batch)
      .select("id, user_number");
    if (error) throw error;
    (data ?? []).forEach((r: { id: string; user_number: string }) => {
      insertedIds.push(r.id);
      insertedAll.push(r);
    });
  }
  await bulkInsertTenantMemos(tenantId, insertedAll, clients);

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

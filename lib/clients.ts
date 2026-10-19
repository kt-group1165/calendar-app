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

// 2026-10-19: replaceAllClients / replaceClientsForOffice / parseClientCSV / bulkInsertTenantMemos を削除。
// どこからも呼ばれておらず、全アプリ共有の clients を消して入れ直す処理だった (replaceAllClients は tenant の全利用者を DELETE)。
// 利用者マスタの取込は order-app / kaigo-app 側で行う。

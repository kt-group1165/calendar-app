import { supabase } from "./supabase";

// Phase 9: members は person-centric。office 所属は member_offices junction で表現。
export type Member = {
  id: string;
  name: string;
  color: string;
  sort_order: number | null;
  created_at: string;
  /** Phase 9: 所属 office UUID 群 (兼務サポート) */
  office_ids: string[];
  /** Phase 9: 主所属 office (給与・既定 view 等)。null は所属無し */
  primary_office_id: string | null;
};

type RawMember = Omit<Member, "office_ids" | "primary_office_id">;
type RawMemberOffice = { member_id: string; office_id: string; is_primary: boolean; color: string | null };

/**
 * member_offices junction を集約。
 * officeId 指定時はその office での member_offices.color を member.color に override する
 * (= 同一 member でも閲覧中 office に応じて色が変わる)。
 */
function mergeOffices(members: RawMember[], junction: RawMemberOffice[], officeId?: string): Member[] {
  const byMember = new Map<string, RawMemberOffice[]>();
  for (const r of junction) {
    if (!byMember.has(r.member_id)) byMember.set(r.member_id, []);
    byMember.get(r.member_id)!.push(r);
  }
  return members.map((m) => {
    const rows = byMember.get(m.id) ?? [];
    const primary = rows.find((r) => r.is_primary);
    // office 文脈の color override
    let color = m.color;
    if (officeId) {
      const moRow = rows.find((r) => r.office_id === officeId);
      if (moRow?.color) color = moRow.color;
    }
    return {
      ...m,
      color,
      office_ids: rows.map((r) => r.office_id),
      primary_office_id: primary?.office_id ?? rows[0]?.office_id ?? null,
    };
  });
}

// officeId 指定時は member_offices.office_id 配列に officeId を含む member のみ返す。
// includeInactive 既定 false: members.status='active' のみ返す
// (退職者を担当者 picker / カレンダー表示から除外)。退職者管理画面など全件必要なら true。
//
// 注: member_offices は全件取得が必要 (各 member の所属 office 配列をマージするため)。
//     1000 行を超える場合があるため range pagination で全件取得する。
export async function getMembers(
  tenantId: string,
  officeId?: string,
  includeInactive: boolean = false,
): Promise<Member[]> {
  // Phase 9-5f: officeId 指定時は tenant フィルタ無視 (= office 中心 fetch)
  //   理由: role-tenant office (fukuyogu-kanri 等) を表示中に、別 tenant (kt-group) の
  //         兼務 member が member_offices 経由で紐付いている場合、tenant フィルタで
  //         はじかれて担当者 chip に出てこなくなる問題があった。
  //   officeId 指定時は member_offices で紐付く全 member を tenant 横断で fetch する。
  //
  // Phase 9-5f-fix: officeId 未指定でも role-tenant (kt-group 以外) の場合は
  //   その tenant の office を自動解決して junction fetch に切り替える。
  //   /fukuyogu-kanri のような single-office tenant は URL に ?office= が無いため
  //   officeId=undefined で getMembers が呼ばれるが、その場合も junction を使いたい。
  if (!officeId && tenantId !== "kt-group") {
    const officeRes = await supabase
      .from("offices")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1)
      .maybeSingle();
    if (officeRes.data) officeId = (officeRes.data as { id: string }).id;
  }
  let memQuery;
  if (officeId) {
    // junction で office に紐付く member_id 集合を引いてから、members を IN 検索
    // (= tenant 横断、ただし退職者は除外)
    const memberIdsRes = await supabase
      .from("member_offices")
      .select("member_id")
      .eq("office_id", officeId);
    if (memberIdsRes.error) throw memberIdsRes.error;
    const memberIds = [
      ...new Set(((memberIdsRes.data ?? []) as { member_id: string }[]).map((r) => r.member_id)),
    ];
    if (memberIds.length === 0) return [];
    memQuery = supabase.from("members").select("*").in("id", memberIds);
  } else {
    memQuery = supabase.from("members").select("*").eq("tenant_id", tenantId);
  }
  // ソフト削除 (deleted_at) は常に除外。includeInactive は「退職者(status)」の話であり
  // 「登録抹消(deleted_at)」とは別概念なので、includeInactive でも抹消済みは出さない。
  memQuery = memQuery.is("deleted_at", null);
  if (!includeInactive) memQuery = memQuery.eq("status", "active");
  const [memRes, allJunction] = await Promise.all([
    memQuery.order("sort_order", { nullsFirst: false }).order("name"),
    (async () => {
      const PAGE = 1000;
      const acc: RawMemberOffice[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("member_offices")
          .select("member_id, office_id, is_primary, color")
          // ⚠ order 無しで range を回すとページごとに並びが変わって行が抜ける。
          //   member_offices に単独の id は無いので複合キーの 2 列で並べる
          .order("member_id")
          .order("office_id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        acc.push(...(data as RawMemberOffice[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return acc;
    })(),
  ]);
  if (memRes.error) throw memRes.error;
  let merged = mergeOffices((memRes.data ?? []) as RawMember[], allJunction, officeId);
  if (officeId) merged = merged.filter((m) => m.office_ids.includes(officeId));
  return merged;
}

// officeId 指定時は member_offices junction に primary 行を INSERT
export async function addMember(
  name: string,
  color: string = "#6366f1",
  tenantId: string,
  officeId?: string,
): Promise<Member> {
  const { data: existing } = await supabase
    .from("members")
    .select("sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const maxOrder = existing?.[0]?.sort_order ?? 0;

  const { data, error } = await supabase
    .from("members")
    .insert({ name, color, sort_order: maxOrder + 1, tenant_id: tenantId })
    .select()
    .single();
  if (error) throw error;

  if (officeId && data?.id) {
    const { error: moError } = await supabase
      .from("member_offices")
      .insert({ member_id: data.id, office_id: officeId, is_primary: true });
    // member_offices が無いとその office のカレンダーから見えなくなる (CLAUDE.md
    // 「自事業所」フィルタは junction 経由) ため、握りつぶさずに投げる。
    // members 行自体は既に作成済みなので、呼び出し元で再試行できるよう member id を伝える。
    if (moError) throw new Error(`スタッフは作成されましたが事業所への割当に失敗しました (member id: ${data.id}): ${moError.message}`);
  }

  const raw = data as RawMember;
  return {
    ...raw,
    office_ids: officeId ? [officeId] : [],
    primary_office_id: officeId ?? null,
  };
}

// Phase 9: member_offices junction の primary を切替
export async function updateMemberOffice(id: string, officeId: string | null): Promise<void> {
  // 旧 primary を非 primary に降格
  await supabase
    .from("member_offices")
    .update({ is_primary: false })
    .eq("member_id", id)
    .eq("is_primary", true);
  if (officeId) {
    await supabase
      .from("member_offices")
      .upsert(
        { member_id: id, office_id: officeId, is_primary: true },
        { onConflict: "member_id,office_id" },
      );
  }
}

export async function updateMemberColor(id: string, color: string): Promise<void> {
  const { error } = await supabase.from("members").update({ color }).eq("id", id);
  if (error) throw error;
}

export async function updateMemberOrder(id: string, sort_order: number): Promise<void> {
  const { error } = await supabase.from("members").update({ sort_order }).eq("id", id);
  if (error) throw error;
}

// ソフト削除: 物理削除せず deleted_at を立てるだけ (member_offices・過去の予定/実績は残す)。
// 復元可能。過去の予定・帳票の担当者名解決 (BY_ID) はフィルタしないので壊れない。
export async function deleteMember(id: string): Promise<void> {
  const { error } = await supabase
    .from("members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ソフト削除の取り消し (ゴミ箱からの復元)
export async function restoreMember(id: string): Promise<void> {
  const { error } = await supabase.from("members").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
}

// 削除済み (ゴミ箱) の member を取得。復元 UI 用。
export async function getDeletedMembers(tenantId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("tenant_id", tenantId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as RawMember[]).map((m) => ({
    ...m,
    office_ids: [],
    primary_office_id: null,
  }));
}

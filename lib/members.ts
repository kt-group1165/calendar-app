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
    await supabase
      .from("member_offices")
      .insert({ member_id: data.id, office_id: officeId, is_primary: true });
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

export async function deleteMember(id: string): Promise<void> {
  // member_offices は ON DELETE CASCADE で自動削除
  const { error } = await supabase.from("members").delete().eq("id", id);
  if (error) throw error;
}

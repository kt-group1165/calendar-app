import { supabase } from "./supabase";

// Phase 9: members は person-centric。office 所属は member_offices junction で表現。
// office_id (single) は @deprecated だが互換性のため残置 (Phase 9 close で DROP 予定)。
export type Member = {
  id: string;
  name: string;
  color: string;
  sort_order: number | null;
  /** @deprecated Phase 9 で member_offices に移行。primary_office_id を使うこと */
  office_id: string | null;
  created_at: string;
  /** Phase 9: 所属 office UUID 群 (兼務サポート) */
  office_ids: string[];
  /** Phase 9: 主所属 office (給与・既定 view 等)。null は所属無し */
  primary_office_id: string | null;
};

type RawMember = Omit<Member, "office_ids" | "primary_office_id">;
type RawMemberOffice = { member_id: string; office_id: string; is_primary: boolean };

function mergeOffices(members: RawMember[], junction: RawMemberOffice[]): Member[] {
  const byMember = new Map<string, RawMemberOffice[]>();
  for (const r of junction) {
    if (!byMember.has(r.member_id)) byMember.set(r.member_id, []);
    byMember.get(r.member_id)!.push(r);
  }
  return members.map((m) => {
    const rows = byMember.get(m.id) ?? [];
    const primary = rows.find((r) => r.is_primary);
    return {
      ...m,
      office_ids: rows.map((r) => r.office_id),
      primary_office_id: primary?.office_id ?? rows[0]?.office_id ?? m.office_id ?? null,
    };
  });
}

// officeId 指定時は member_offices.office_id 配列に officeId を含む member のみ返す
export async function getMembers(tenantId: string, officeId?: string): Promise<Member[]> {
  const [memRes, junRes] = await Promise.all([
    supabase.from("members").select("*").eq("tenant_id", tenantId)
      .order("sort_order", { nullsFirst: false }).order("name"),
    supabase.from("member_offices").select("member_id, office_id, is_primary"),
  ]);
  if (memRes.error) throw memRes.error;
  if (junRes.error) throw junRes.error;
  let merged = mergeOffices((memRes.data ?? []) as RawMember[], (junRes.data ?? []) as RawMemberOffice[]);
  if (officeId) merged = merged.filter((m) => m.office_ids.includes(officeId));
  return merged;
}

// officeId 指定時は member_offices junction にも primary 行を INSERT
export async function addMember(
  name: string,
  color: string = "#6366f1",
  tenantId: string,
  officeId?: string,
): Promise<Member> {
  let existingQuery = supabase
    .from("members")
    .select("sort_order")
    .eq("tenant_id", tenantId);
  if (officeId) existingQuery = existingQuery.eq("office_id", officeId);
  const { data: existing } = await existingQuery
    .order("sort_order", { ascending: false })
    .limit(1);
  const maxOrder = existing?.[0]?.sort_order ?? 0;

  const insertPayload: { name: string; color: string; sort_order: number; tenant_id: string; office_id?: string } = {
    name,
    color,
    sort_order: maxOrder + 1,
    tenant_id: tenantId,
  };
  if (officeId) insertPayload.office_id = officeId;

  const { data, error } = await supabase
    .from("members")
    .insert(insertPayload)
    .select()
    .single();
  if (error) throw error;

  // Phase 9: member_offices junction にも primary 行を追加 (officeId 指定時)
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

// Phase 9: member_offices junction の primary を切替 (members.office_id も互換維持で同期)
export async function updateMemberOffice(id: string, officeId: string | null): Promise<void> {
  // 1) members.office_id を互換維持で更新 (Phase 9 close で DROP)
  const { error: e1 } = await supabase.from("members").update({ office_id: officeId }).eq("id", id);
  if (e1) throw e1;

  // 2) member_offices junction を replace
  if (officeId) {
    // 旧 primary を非 primary に降格
    await supabase
      .from("member_offices")
      .update({ is_primary: false })
      .eq("member_id", id)
      .eq("is_primary", true);
    // 新 primary を upsert
    await supabase
      .from("member_offices")
      .upsert(
        { member_id: id, office_id: officeId, is_primary: true },
        { onConflict: "member_id,office_id" },
      );
  } else {
    // primary 解除 (junction は触らない、is_primary=false に戻すのみ)
    await supabase
      .from("member_offices")
      .update({ is_primary: false })
      .eq("member_id", id)
      .eq("is_primary", true);
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

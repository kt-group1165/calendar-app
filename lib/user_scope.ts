import { getSupabase } from "./supabase-browser";

/**
 * カレンダー閲覧スコープの effective 計算。
 *
 * 戻り値の意味:
 *   - { kind: "group_admin", allowedOfficeIds: null }
 *       全イベント閲覧可 (officeIds フィルタ無し)。
 *   - { kind: "office_admin", allowedOfficeIds: [...] }
 *       自分の所属 offices + 「管理者用」office (service_type='本社') のイベントのみ。
 *   - { kind: "member", allowedOfficeIds: [...] }
 *       自分の所属 offices のイベントのみ。
 *   - { kind: "anonymous", allowedOfficeIds: [] }
 *       未認証 (本来は proxy が /login へ追放するため呼び出されない想定)。
 *
 * 設計判断:
 *   - 「管理者用」のマーカーは offices.service_type='本社' を採用。
 *     現状 kt-group/本社 と fukuyogu-kanri/福祉用具管理者 が該当 (どちらも非 active)。
 *   - group_admin の判定は auth_user_admin_tenants() の中に tenants.tenant_type='group'
 *     なものが含まれるかで行う (= kt-group 等)。
 *   - office_admin は user_offices.role='office_admin' な行が 1 つでもあれば該当。
 */
export type UserScope =
  | { kind: "group_admin"; allowedOfficeIds: null }
  | { kind: "office_admin"; allowedOfficeIds: string[] }
  | { kind: "member"; allowedOfficeIds: string[] }
  | { kind: "anonymous"; allowedOfficeIds: [] };

export async function getUserScope(): Promise<UserScope> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { kind: "anonymous", allowedOfficeIds: [] };
  }

  // 1) admin tenants
  const { data: adminTenantsData } = await supabase.rpc("auth_user_admin_tenants");
  type R = { auth_user_admin_tenants?: string } | string;
  const adminTenantIds = ((adminTenantsData ?? []) as R[])
    .map((r) => (typeof r === "string" ? r : r.auth_user_admin_tenants ?? ""))
    .filter(Boolean);

  // 2) group-type tenant の admin なら group_admin
  if (adminTenantIds.length > 0) {
    const { data: groupCheck } = await supabase
      .from("tenants")
      .select("id")
      .in("id", adminTenantIds)
      .eq("tenant_type", "group");
    if ((groupCheck ?? []).length > 0) {
      return { kind: "group_admin", allowedOfficeIds: null };
    }
  }

  // 3) user_offices で自分の所属 office + 役割
  const { data: userOffices } = await supabase
    .from("user_offices")
    .select("office_id, role")
    .eq("user_id", user.id);
  type UO = { office_id: string; role: string };
  const myOfficeIds = ((userOffices ?? []) as UO[]).map((uo) => uo.office_id);
  const isOfficeAdmin = ((userOffices ?? []) as UO[]).some((uo) => uo.role === "office_admin");

  if (isOfficeAdmin) {
    // 本社 service_type の office_ids を追加 (= 管理者用カレンダー)
    const { data: honsha } = await supabase
      .from("offices")
      .select("id")
      .eq("service_type", "本社");
    type O = { id: string };
    const honshaIds = ((honsha ?? []) as O[]).map((o) => o.id);
    return {
      kind: "office_admin",
      allowedOfficeIds: [...new Set([...myOfficeIds, ...honshaIds])],
    };
  }

  return { kind: "member", allowedOfficeIds: myOfficeIds };
}

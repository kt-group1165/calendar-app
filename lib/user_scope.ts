import { getSupabase } from "./supabase-browser";

/**
 * カレンダー閲覧スコープの effective 計算。
 *
 * 戻り値の意味:
 *   - { kind: "group_admin", allowedOfficeIds: null }
 *       全イベント閲覧可 (officeIds フィルタ無し)。
 *   - { kind: "office_admin", allowedOfficeIds: [...] }
 *       自分の所属 offices + 「管理者用」office (fukuyogu-kanri tenant) のイベントのみ。
 *   - { kind: "member", allowedOfficeIds: [...] }
 *       自分の所属 offices のイベントのみ。
 *   - { kind: "anonymous", allowedOfficeIds: [] }
 *       未認証 (本来は proxy が /login へ追放するため呼び出されない想定)。
 *
 * 設計判断:
 *   - 「管理者用」のマーカーは offices.tenant_id='fukuyogu-kanri' を採用。
 *     現状は 福祉用具管理者 office のみが該当 (kt-group/本社 は閲覧不要との user 判断)。
 *   - 将来 admin calendar を追加する場合は ADMIN_CALENDAR_TENANT_IDS に列挙する。
 *   - group_admin の判定は auth_user_admin_tenants() の中に tenants.tenant_type='group'
 *     なものが含まれるかで行う (= kt-group 等)。
 *   - office_admin は user_offices.role='office_admin' な行が 1 つでもあれば該当。
 */
const ADMIN_CALENDAR_TENANT_IDS = ["fukuyogu-kanri"] as const;
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
    // 管理者用カレンダーの office_ids を追加 (fukuyogu-kanri tenant 配下)
    const { data: adminCals } = await supabase
      .from("offices")
      .select("id")
      .in("tenant_id", ADMIN_CALENDAR_TENANT_IDS as readonly string[] as string[]);
    type O = { id: string };
    const adminCalIds = ((adminCals ?? []) as O[]).map((o) => o.id);
    return {
      kind: "office_admin",
      allowedOfficeIds: [...new Set([...myOfficeIds, ...adminCalIds])],
    };
  }

  return { kind: "member", allowedOfficeIds: myOfficeIds };
}

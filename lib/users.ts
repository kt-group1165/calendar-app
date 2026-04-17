import { getSupabase } from "./supabase-browser";

export type Role = "master" | "member";

export type TenantUser = {
  user_id: string;
  tenant_id: string;
  role: Role;
  member_id: string | null;
  created_at: string;
  // ジョイン結果
  email?: string | null;
  member_name?: string | null;
};

// テナント所属ユーザー一覧（管理パネル用）
// RLS により、呼び出しユーザーがそのテナントの master でないと見えない。
export async function getTenantUsers(tenantId: string): Promise<TenantUser[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_tenants")
    .select("user_id, tenant_id, role, member_id, created_at, members(name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  type Row = {
    user_id: string;
    tenant_id: string;
    role: Role;
    member_id: string | null;
    created_at: string;
    members: { name: string } | { name: string }[] | null;
  };
  return (data as Row[] ?? []).map((r) => {
    const mem = Array.isArray(r.members) ? r.members[0] : r.members;
    return {
      user_id: r.user_id,
      tenant_id: r.tenant_id,
      role: r.role,
      member_id: r.member_id,
      created_at: r.created_at,
      member_name: mem?.name ?? null,
    };
  });
}

// ロール変更（master ⇆ member）
export async function updateUserRole(userId: string, tenantId: string, role: Role): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("user_tenants")
    .update({ role })
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  if (error) throw error;
}

// テナントから外す（auth.users は消さない）
export async function removeUserFromTenant(userId: string, tenantId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("user_tenants")
    .delete()
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  if (error) throw error;
}

// メンバー紐付けの変更
export async function updateUserMemberLink(userId: string, tenantId: string, memberId: string | null): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("user_tenants")
    .update({ member_id: memberId })
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  if (error) throw error;
}

// Auth ユーザーがまだ誰も居ないか判定（セットアップフロー用）
// user_tenants の RLS により、匿名アクセスの count はテナント情報なしでは 0 になる場合がある。
// 確実に判定するため、サーバー側で head+count を使う。
export async function hasAnyUser(): Promise<boolean> {
  const supabase = getSupabase();
  const { count } = await supabase
    .from("user_tenants")
    .select("*", { count: "exact", head: true });
  return (count ?? 0) > 0;
}

// 自分が所属しているテナント一覧（RLS 経由）
export async function getMyTenants(): Promise<{ tenant_id: string; role: Role }[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("user_tenants")
    .select("tenant_id, role")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data ?? []) as { tenant_id: string; role: Role }[];
}

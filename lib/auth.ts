"use client";

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase-browser";

// Phase 2-7 以降:
//   - PIN モード（localStorage 経路の匿名利用）は廃止。
//     全ユーザは Supabase Auth セッション持ち。
//   - role / member_id は新 4 階層 RLS から derive：
//     - role:      auth_user_admin_tenants() rpc に tenantId が含まれれば 'master'、
//                  そうでなく user_offices に行があれば 'member'、なければ null
//     - member_id: user_offices.member_id (offices.tenant_id でフィルタ)

export type Role = "master" | "member";

export type CurrentUser = {
  name: string | null;       // 表示用（members.name → user_metadata.display_name → email の順）
  authUser: User | null;     // Supabase Auth セッション。未ログインなら null（proxy が /login へ追放）
  role: Role | null;         // このテナントでのロール
  memberId: string | null;   // 紐づく members.id
  // この tenant 内での自分の primary office.id。
  //   - office_admin / member: user_offices.is_primary=true の行（無ければ最初の行）
  //   - group_admin / company_admin: 通常 null（user_offices に直接行を持たないため）
  // [tenant]/page.tsx で「URL に ?office= 無し かつ primaryOfficeId あり」のとき
  // 自動で ?office=<id> へ遷移して自 office に絞った view を出す UX に使う。
  primaryOfficeId: string | null;
  loading: boolean;
};

export function useCurrentUser(tenantId: string): CurrentUser {
  const [state, setState] = useState<CurrentUser>({
    name: null,
    authUser: null,
    role: null,
    memberId: null,
    primaryOfficeId: null,
    loading: true,
  });

  useEffect(() => {
    if (!tenantId) return;
    const supabase = getSupabase();
    let cancelled = false;

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!user) {
        // 未ログイン。proxy で /login へ redirect される想定だが、
        // 念のため state を空で返す（呼出側が読み込み完了として扱う）。
        setState({ name: null, authUser: null, role: null, memberId: null, primaryOfficeId: null, loading: false });
        return;
      }

      const [adminTenantsRes, officeRowRes] = await Promise.all([
        supabase.rpc("auth_user_admin_tenants"),
        // primary office を選ぶ：is_primary=true を優先、無ければ最初の row。
        // 同じユーザが複数 office に居る場合に「どれを default 表示にするか」の決定。
        supabase
          .from("user_offices")
          .select("office_id, member_id, is_primary, offices!inner(tenant_id)")
          .eq("user_id", user.id)
          .eq("offices.tenant_id", tenantId)
          .order("is_primary", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      // rpc が SETOF TEXT を返すと PostgREST は [{ auth_user_admin_tenants: 'kt-group' }, ...]
      // または ['kt-group', ...] を返しうる。両方に対応。
      type TenantRow = { auth_user_admin_tenants?: string } | string;
      const rawAdmin = (adminTenantsRes.data ?? []) as TenantRow[];
      const adminTenantIds = rawAdmin.map((r) =>
        typeof r === "string" ? r : r.auth_user_admin_tenants ?? ""
      );

      type OfficeRow = { office_id: string; member_id: string | null; is_primary: boolean };
      const officeRow = officeRowRes.data as OfficeRow | null;

      const isAdmin = adminTenantIds.includes(tenantId);
      const hasOfficeAssignment = officeRow !== null;
      const role: Role | null = isAdmin
        ? "master"
        : (hasOfficeAssignment ? "member" : null);
      const memberId = officeRow?.member_id ?? null;
      const primaryOfficeId = officeRow?.office_id ?? null;

      let name: string | null = null;
      if (memberId) {
        const { data: m } = await supabase
          .from("members")
          .select("name")
          .eq("id", memberId)
          .maybeSingle();
        name = m?.name ?? null;
      }
      if (!name) {
        name = (user.user_metadata?.display_name as string | undefined) ?? user.email ?? "ユーザー";
      }

      if (cancelled) return;
      setState({
        name,
        authUser: user,
        role,
        memberId,
        primaryOfficeId,
        loading: false,
      });
    }

    load();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [tenantId]);

  return state;
}

export async function signOut() {
  const supabase = getSupabase();
  await supabase.auth.signOut();
}

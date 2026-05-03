"use client";

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase-browser";

export type Role = "master" | "member";

export type CurrentUser = {
  name: string | null;       // 表示用（Auth → members.name → email の順）
  authUser: User | null;     // Supabase Auth セッション（null なら匿名/PIN モード）
  role: Role | null;         // このテナントでのロール（旧 calendar-app 概念。新 RLS では derive）
  memberId: string | null;   // 紐づく members.id
  loading: boolean;
};

const USER_NAME_KEY = (tid: string) => `calendar_user_name_${tid}`;
const IS_MASTER_KEY = (tid: string) => `calendar_is_master_${tid}`;

export function useCurrentUser(tenantId: string): CurrentUser {
  const [state, setState] = useState<CurrentUser>({
    name: null,
    authUser: null,
    role: null,
    memberId: null,
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
        // 匿名モード（旧 PIN 方式互換）。Phase 2-7 招待 UI 完成後に削除予定。
        if (typeof window !== "undefined") {
          const name = localStorage.getItem(USER_NAME_KEY(tenantId));
          const isMaster = localStorage.getItem(IS_MASTER_KEY(tenantId)) === "true";
          setState({
            name: name ?? "",
            authUser: null,
            role: isMaster ? "master" : (name ? "member" : null),
            memberId: null,
            loading: false,
          });
        }
        return;
      }

      // Auth セッションあり → 新 4 階層 RLS から role / member_id を derive
      //   role:      auth_user_admin_tenants() rpc に tenantId が含まれれば 'master'、
      //              そうでなく user_offices に行があれば 'member'、なければ null
      //   member_id: user_offices.member_id (offices.tenant_id でフィルタ)
      const [adminTenantsRes, officeRowRes] = await Promise.all([
        supabase.rpc("auth_user_admin_tenants"),
        supabase
          .from("user_offices")
          .select("member_id, offices!inner(tenant_id)")
          .eq("user_id", user.id)
          .eq("offices.tenant_id", tenantId)
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

      type OfficeRow = { member_id: string | null };
      const officeRow = officeRowRes.data as OfficeRow | null;

      const isAdmin = adminTenantIds.includes(tenantId);
      const hasOfficeAssignment = officeRow !== null;
      const role: Role | null = isAdmin
        ? "master"
        : (hasOfficeAssignment ? "member" : null);
      const memberId = officeRow?.member_id ?? null;

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
        loading: false,
      });
    }

    load();

    // セッション変化を監視
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

// PIN モード用（既存互換）: localStorage に名前と master フラグを保存
export function savePinModeUser(tenantId: string, name: string, isMaster: boolean) {
  localStorage.setItem(USER_NAME_KEY(tenantId), name);
  if (isMaster) localStorage.setItem(IS_MASTER_KEY(tenantId), "true");
}

export function clearPinModeUser(tenantId: string) {
  localStorage.removeItem(USER_NAME_KEY(tenantId));
  localStorage.removeItem(IS_MASTER_KEY(tenantId));
}

// Auth ログアウト
export async function signOut() {
  const supabase = getSupabase();
  await supabase.auth.signOut();
}

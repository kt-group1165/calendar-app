"use client";

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase-browser";

export type Role = "master" | "member";

export type CurrentUser = {
  name: string | null;       // 表示用（Auth → members.name → email の順）
  authUser: User | null;     // Supabase Auth セッション（null なら匿名/PIN モード）
  role: Role | null;         // このテナントでのロール
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
        // 匿名モード（旧 PIN 方式互換）
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

      // Auth セッションあり → user_tenants から role, member_id を解決
      const { data: ut } = await supabase
        .from("user_tenants")
        .select("role, member_id")
        .eq("user_id", user.id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (cancelled) return;

      let name: string | null = null;
      let memberId: string | null = ut?.member_id ?? null;

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
        role: (ut?.role as Role | undefined) ?? null,
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

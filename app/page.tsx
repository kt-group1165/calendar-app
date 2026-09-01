"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Fingerprint, Loader2, LogOut, User as UserIcon, Building2, Briefcase } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { getTenants, type Tenant } from "@/lib/tenants";
import { getOffices, type Office } from "@/lib/offices";
import { getSupabase } from "@/lib/supabase-browser";
import { signOut } from "@/lib/auth";
import { getUserScope } from "@/lib/user_scope";

// ホーム画面（テナント + office picker）。
// Phase 8 (2026-05-08) — office-centric 統合に伴い top page を再設計:
//   - 役職横断 tenants (sales-hq / honsha / fukuyogu-kanri 等) は引続きそのまま表示
//   - 福祉用具事業所 (offices.service_type IN CALENDAR_SERVICE_TYPES) は kt-group 内の
//     office を直接 picker に出す → /kt-group?office=<id> に遷移
//   - kt-group 自体 (全 office まとめてビュー) も「全社」として表示
//   - test tenants (default / test) は非表示
// データ層は kt-group 1 tenant 統合、UI 層で見やすくグルーピング。
// 設計: memory/project_phase_8_office_centric.md

export default function HomePage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  // 全社ビュー (group tenant) を見せるべきか。group_admin / company_admin
  // のように特定 office を持たないユーザには「全 office まとめて表示」が有用だが、
  // 通常 staff (user_offices に primary office あり) は primary に遷移するだけで
  // 終わるので冗長。auth_user_admin_tenants() に group tenant が含まれてるかで判定。
  const [showGroupView, setShowGroupView] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();

      const { data: { user } } = await supabase.auth.getUser();
      setAuthUser(user);
      if (!user) {
        router.replace("/login?next=/");
        return;
      }

      try {
        const [tList, oList, adminGroupsRes, adminCompaniesRes, scope] = await Promise.all([
          getTenants(),
          // kt-group の福祉用具/本社 office を取得
          // RLS は緩めで tenant 内全 office 見えるため、ここで userScope で絞る:
          //   member → 自 office のみ / office_admin → 自 office + admin calendar /
          //   group_admin → 全 office (現状維持)
          getOffices("kt-group").catch(() => [] as Office[]),
          // group_admin である group の集合 (空なら group_admin ではない)
          supabase.rpc("auth_admin_group_ids"),
          // company_admin である company の集合
          supabase.rpc("auth_admin_company_ids"),
          // 閲覧スコープ (getOffices と並行で取得)
          getUserScope(),
        ]);
        const visible = tList.filter((t) => t.tenant_type !== "test");
        setTenants(visible);
        // scope.allowedOfficeIds が null = group_admin → フィルタ無し
        // 配列なら member / office_admin → 自分のスコープ内の office のみ
        const allowedSet = scope.allowedOfficeIds === null ? null : new Set(scope.allowedOfficeIds);
        const filteredOffices = allowedSet === null ? oList : oList.filter((o) => allowedSet.has(o.id));
        setOffices(filteredOffices);
        const groupT = visible.find((t) => t.tenant_type === "group");
        // 「全社ビュー」を見せるのは group_admin / company_admin のみ
        // (office_admin は自 office に属する範囲だけで OK)
        const isGroupOrCompanyAdmin =
          ((adminGroupsRes.data ?? []) as unknown[]).length > 0 ||
          ((adminCompaniesRes.data ?? []) as unknown[]).length > 0;
        const localShowGroupView = !!groupT && isGroupOrCompanyAdmin;
        setShowGroupView(localShowGroupView);

        // ── アクセス可能な destination が 1 つだけならスキップして直行 ──
        const localRoleTenants = visible.filter((t) => t.tenant_type === "role");
        const totalDestinations =
          localRoleTenants.length + filteredOffices.length + (localShowGroupView ? 1 : 0);
        if (totalDestinations === 1) {
          // 単一 office: /[group]?office=<id>
          if (filteredOffices.length === 1 && groupT) {
            router.replace(`/${groupT.id}?office=${filteredOffices[0].id}`);
            return;
          }
          // 単一役職 tenant: /[role]
          if (localRoleTenants.length === 1) {
            router.replace(`/${localRoleTenants[0].id}`);
            return;
          }
          // 単一 group tenant (admin が全社ビューだけ): /[group]
          if (localShowGroupView && groupT) {
            router.replace(`/${groupT.id}`);
            return;
          }
        }
      } catch (e) {
        // 取得失敗を握りつぶすと tenants/offices が空のまま「所属するチームが
        // ありません」という誤った表示になる (実際は権限を持っているのに
        // RPC の一時的失敗等で false negative になる)。専用の error state で
        // 区別する。
        console.warn("[page] tenants/offices load failed:", e);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const roleTenants = useMemo(
    () => tenants.filter((t) => t.tenant_type === "role"),
    [tenants],
  );
  const groupTenant = useMemo(
    () => tenants.find((t) => t.tenant_type === "group") ?? null,
    [tenants],
  );

  async function handleLogout() {
    if (!confirm("ログアウトしますか？")) return;
    await signOut();
    router.replace("/login");
  }

  function goToOffice(officeId: string) {
    if (!groupTenant) return;
    router.push(`/${groupTenant.id}?office=${officeId}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl shadow-lg mb-2">
            <CalendarDays size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">カレンダー</h1>
          <p className="text-sm text-gray-400">事業所またはチームを選択してください</p>
        </div>

        {authUser && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
              <UserIcon size={14} className="text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400">ログイン中</p>
              <p className="text-sm font-medium text-gray-800 truncate">{authUser.email}</p>
            </div>
            <button
              onClick={() => router.push("/passkeys")}
              className="p-2 rounded-xl hover:bg-indigo-50 text-gray-400 hover:text-indigo-500 shrink-0"
              title="パスキー管理"
            >
              <Fingerprint size={14} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-400 shrink-0"
              title="ログアウト"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex justify-center py-10">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
          </div>
        ) : loadError ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 py-10">
            <p className="text-sm text-red-400 text-center">
              読み込みに失敗しました。時間をおいて再読み込みしてください。
            </p>
          </div>
        ) : tenants.length === 0 && offices.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 py-10">
            <p className="text-sm text-gray-400 text-center">
              所属するチームがありません。管理者に招待を依頼してください。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 福祉用具事業所セクション */}
            {offices.length > 0 && (
              <Section title="事業所" icon={<Building2 size={12} className="text-emerald-500" />}>
                {offices.map((o) => (
                  <Row
                    key={o.id}
                    label={o.name}
                    sublabel={o.service_type ?? undefined}
                    onClick={() => goToOffice(o.id)}
                    iconBg="bg-emerald-100"
                    iconColor="text-emerald-500"
                  />
                ))}
              </Section>
            )}

            {/* 役職横断セクション */}
            {roleTenants.length > 0 && (
              <Section title="役職横断" icon={<Briefcase size={12} className="text-amber-500" />}>
                {roleTenants.map((t) => (
                  <Row
                    key={t.id}
                    label={t.name}
                    onClick={() => router.push(`/${t.id}`)}
                    iconBg="bg-amber-100"
                    iconColor="text-amber-500"
                  />
                ))}
              </Section>
            )}

            {/* 全社ビュー (group tenant) — admin のみ表示 */}
            {groupTenant && showGroupView && (
              <Section title="全社ビュー" icon={<CalendarDays size={12} className="text-indigo-500" />}>
                <Row
                  label={groupTenant.name}
                  sublabel="全事業所をまとめて表示"
                  onClick={() => router.push(`/${groupTenant.id}`)}
                  iconBg="bg-indigo-100"
                  iconColor="text-indigo-500"
                />
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 mb-1.5">
        {icon}
        <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          {title}
        </h2>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <ul className="divide-y divide-gray-50">{children}</ul>
      </div>
    </div>
  );
}

function Row({
  label,
  sublabel,
  onClick,
  iconBg,
  iconColor,
}: {
  label: string;
  sublabel?: string;
  onClick: () => void;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-indigo-50 transition-colors active:bg-indigo-100"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center shrink-0`}>
            <CalendarDays size={18} className={iconColor} />
          </div>
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{label}</p>
            {sublabel && <p className="text-[10px] text-gray-400 truncate">{sublabel}</p>}
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-300 shrink-0" />
      </button>
    </li>
  );
}

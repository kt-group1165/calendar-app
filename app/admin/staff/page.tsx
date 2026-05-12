"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Fingerprint,
  Loader2,
  Lock,
  Plus,
  ShieldOff,
  Star,
  Trash2,
  TriangleAlert,
  UserPlus,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { format, formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { getSupabase } from "@/lib/supabase-browser";

// /admin/staff
//
// office_admin / company_admin / group_admin がスタッフを招待・管理する画面。
// 招待は URL + 初期パスワード方式（メール不使用）。
//
// 設計: HANDOVER_NEXT_SESSION.md §13、Phase 2-7

type InvitationListItem = {
  token: string;
  display_name: string;
  office_id: string;
  office_name: string | null;
  role: "office_admin" | "member";
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_user_id: string | null;
  member_status: string | null; // 'active' / 'inactive' / null (member 紐付け無し)
  member_id: string | null;     // consume 済 staff の members.id (Phase 9-4)
  // Phase 9-4: 複数 office 所属表示用 (member_offices junction から)
  member_office_assignments: Array<{ office_id: string; office_name: string | null; is_primary: boolean }>;
};

type OfficeOption = {
  id: string;
  name: string;
  tenant_id: string;
  tenant_name: string | null;
};

export default function AdminStaffPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [offices, setOffices] = useState<OfficeOption[]>([]);
  const [invitations, setInvitations] = useState<InvitationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNewModal, setShowNewModal] = useState(false);
  const [issued, setIssued] = useState<{
    invite_url: string;
    initial_password: string;
    display_name: string;
    login_id: string | null;
    login_id_was_renamed: boolean;
    expires_at: string | null;
  } | null>(null);

  // Phase 11c: 承認待ち端末リスト (admin scope 内の user の trusted_devices.status='pending')
  type PendingDevice = {
    id: string;
    user_id: string;
    device_id: string;
    device_label: string | null;
    first_seen_ua: string | null;
    first_seen_ip: string | null;
    created_at: string;
    user_display_name: string | null;
  };
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([]);

  // 認証 + 権限ガード:
  //   未ログイン → /login へ
  //   一般 staff (role='member' のみで admin tenant 持たない) → / へ追放
  //   group_admin / company_admin / office_admin だけが /admin/staff にアクセス可能
  useEffect(() => {
    const supabase = getSupabase();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setAuthUser(user);
      if (!user) {
        router.replace("/login?next=/admin/staff");
        setAuthChecked(true);
        return;
      }
      // 権限チェック: auth_user_admin_tenants に何か / user_offices.role='office_admin' あれば admin
      const [adminTenantsRes, officeAdminRes] = await Promise.all([
        supabase.rpc("auth_user_admin_tenants"),
        supabase.from("user_offices").select("office_id").eq("user_id", user.id).eq("role", "office_admin"),
      ]);
      const hasAdminTenant = ((adminTenantsRes.data ?? []) as unknown[]).length > 0;
      const isOfficeAdmin = ((officeAdminRes.data ?? []) as unknown[]).length > 0;
      if (!hasAdminTenant && !isOfficeAdmin) {
        // 一般 staff: 権限なしで /admin/staff にアクセス → ホームへ追い返す
        router.replace("/");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();

      // 自分が見える office を取得（offices_visible_read policy が enforce）。
      // tenant 名も join。
      // offices, tenants, admin 可能 office 集合を並列取得し、client-side で join + filter。
      // offices.tenant_id (TEXT) → tenants.id の FK は PostgREST が認識できない
      // ことがあるため（明示 FK が無い）、resource embedding は使わない。
      // admin_office_ids は §13-2 に従い「招待発行可能な office」だけに絞るため。
      const [officesRes, tenantsRes, adminRes] = await Promise.all([
        supabase
          .from("offices")
          .select("id, name, tenant_id")
          .order("tenant_id", { ascending: true })
          .order("sort_order", { ascending: true }),
        supabase.from("tenants").select("id, name"),
        supabase.rpc("auth_admin_office_ids"),
      ]);
      if (officesRes.error) throw officesRes.error;
      if (tenantsRes.error) throw tenantsRes.error;
      if (adminRes.error) throw adminRes.error;

      type OfficeRow = { id: string; name: string; tenant_id: string };
      type TenantRow = { id: string; name: string };
      type AdminRow = { auth_admin_office_ids?: string } | string;
      const tenantNameById = new Map(
        ((tenantsRes.data ?? []) as TenantRow[]).map((t) => [t.id, t.name] as const)
      );
      const adminOfficeIds = new Set(
        ((adminRes.data ?? []) as AdminRow[]).map((r) =>
          typeof r === "string" ? r : r.auth_admin_office_ids ?? ""
        )
      );
      const officeOpts: OfficeOption[] = ((officesRes.data ?? []) as OfficeRow[])
        .filter((r) => adminOfficeIds.has(r.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          tenant_id: r.tenant_id,
          tenant_name: tenantNameById.get(r.tenant_id) ?? null,
        }));
      setOffices(officeOpts);

      // 自分が見える招待一覧（staff_invitations_admin_read policy が enforce）
      const { data: invRows, error: invError } = await supabase
        .from("staff_invitations")
        .select("token, display_name, office_id, role, created_at, expires_at, consumed_at, consumed_user_id")
        .order("created_at", { ascending: false });
      if (invError) throw invError;

      const officeNameById = new Map(officeOpts.map((o) => [o.id, o.name] as const));
      type InvRow = {
        token: string;
        display_name: string;
        office_id: string;
        role: "office_admin" | "member";
        created_at: string;
        expires_at: string;
        consumed_at: string | null;
        consumed_user_id: string | null;
      };

      // 各 consume 済 user の members.status を引き当てる
      // (auth.users → user_offices.user_id → user_offices.member_id → members.id → status)
      // Phase 9-4: 同時に member_id と member_offices junction も取得して、
      //            複数 office 所属を表示する。
      const consumedUserIds = ((invRows ?? []) as InvRow[])
        .map((r) => r.consumed_user_id)
        .filter((id): id is string => !!id);
      const memberStatusByUserId = new Map<string, string | null>();
      const memberIdByUserId = new Map<string, string | null>();
      const officesByMemberId = new Map<
        string,
        Array<{ office_id: string; office_name: string | null; is_primary: boolean }>
      >();
      if (consumedUserIds.length > 0) {
        const { data: uoRows } = await supabase
          .from("user_offices")
          .select("user_id, member_id")
          .in("user_id", consumedUserIds);
        type UoRow = { user_id: string; member_id: string | null };
        const uoTyped = (uoRows ?? []) as UoRow[];
        for (const u of uoTyped) {
          if (!memberIdByUserId.has(u.user_id) && u.member_id) {
            memberIdByUserId.set(u.user_id, u.member_id);
          }
        }
        const memberIds = Array.from(
          new Set(uoTyped.map((u) => u.member_id).filter((m): m is string => !!m))
        );
        if (memberIds.length > 0) {
          const [mRowsRes, junRowsRes, allOfficesRes] = await Promise.all([
            supabase.from("members").select("id, status").in("id", memberIds),
            supabase
              .from("member_offices")
              .select("member_id, office_id, is_primary")
              .in("member_id", memberIds),
            // 全 offices (admin 範囲外も含めて name を引くため、tenant scoped で取得)
            supabase.from("offices").select("id, name"),
          ]);
          type MemberRow = { id: string; status: string | null };
          type JunRow = { member_id: string; office_id: string; is_primary: boolean | null };
          type OfficeRow2 = { id: string; name: string };
          const statusById = new Map(
            ((mRowsRes.data ?? []) as MemberRow[]).map((m) => [m.id, m.status] as const)
          );
          const allOfficeNameById = new Map(
            ((allOfficesRes.data ?? []) as OfficeRow2[]).map((o) => [o.id, o.name] as const)
          );
          for (const u of uoTyped) {
            if (u.member_id) {
              memberStatusByUserId.set(u.user_id, statusById.get(u.member_id) ?? null);
            }
          }
          for (const j of (junRowsRes.data ?? []) as JunRow[]) {
            const arr = officesByMemberId.get(j.member_id) ?? [];
            arr.push({
              office_id: j.office_id,
              office_name: allOfficeNameById.get(j.office_id) ?? null,
              is_primary: j.is_primary === true,
            });
            officesByMemberId.set(j.member_id, arr);
          }
          for (const [k, arr] of officesByMemberId) {
            arr.sort((a, b) => {
              if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
              return (a.office_name ?? "").localeCompare(b.office_name ?? "");
            });
            officesByMemberId.set(k, arr);
          }
        }
      }

      setInvitations(
        ((invRows ?? []) as InvRow[]).map((r) => {
          const memberId = r.consumed_user_id
            ? (memberIdByUserId.get(r.consumed_user_id) ?? null)
            : null;
          return {
            token: r.token,
            display_name: r.display_name,
            office_id: r.office_id,
            office_name: officeNameById.get(r.office_id) ?? null,
            role: r.role,
            created_at: r.created_at,
            expires_at: r.expires_at,
            consumed_at: r.consumed_at,
            consumed_user_id: r.consumed_user_id,
            member_status: r.consumed_user_id
              ? (memberStatusByUserId.get(r.consumed_user_id) ?? null)
              : null,
            member_id: memberId,
            member_office_assignments: memberId
              ? (officesByMemberId.get(memberId) ?? [])
              : [],
          };
        })
      );

      // Phase 11c: 承認待ち端末を引いてくる (RLS で admin scope 内のみ見える)
      const { data: pendingRows } = await supabase
        .from("trusted_devices")
        .select("id, user_id, device_id, device_label, first_seen_ua, first_seen_ip, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      // user_id → display_name の解決 (consumed_user_id 経由で invitation の display_name を逆引き)
      const displayNameByUserId = new Map<string, string>();
      for (const r of (invRows ?? []) as InvRow[]) {
        if (r.consumed_user_id) displayNameByUserId.set(r.consumed_user_id, r.display_name);
      }
      setPendingDevices(
        ((pendingRows ?? []) as Omit<PendingDevice, "user_display_name">[]).map((p) => ({
          ...p,
          user_display_name: displayNameByUserId.get(p.user_id) ?? null,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "読込に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authChecked || !authUser) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- HANDOVER §2 (mount-time async fetch / mount init)
    reload();
  }, [authChecked, authUser]);

  // 招待 (未 consume) の取消: staff_invitations を delete するだけ。
  async function handleCancelInvitation(token: string, displayName: string) {
    if (!confirm(`「${displayName}」の招待を取り消しますか？\n（招待 URL は無効になります）`)) return;
    const supabase = getSupabase();
    const { error: deleteError } = await supabase
      .from("staff_invitations")
      .delete()
      .eq("token", token);
    if (deleteError) {
      alert(`取消に失敗しました: ${deleteError.message}`);
      return;
    }
    reload();
  }

  // 削除前: そのスタッフが過去どれだけ予定/コメントに紐付いてるか
  // count を取得 (events.assignees は TEXT[] / events.created_by は user.id /
  // comments.author は TEXT[name])
  async function fetchUsageCounts(displayName: string, userId: string | null) {
    const supabase = getSupabase();
    const queries: Array<Promise<{ count: number | null }>> = [
      // 担当者として記録 (text[] match)
      supabase.from("events").select("*", { count: "exact", head: true }).contains("assignees", [displayName]),
      // コメント author
      supabase.from("comments").select("*", { count: "exact", head: true }).eq("author", displayName),
    ];
    if (userId) {
      // 作成者 / 最終編集者 (FK)
      queries.push(supabase.from("events").select("*", { count: "exact", head: true }).eq("created_by", userId));
      queries.push(supabase.from("events").select("*", { count: "exact", head: true }).eq("updated_by", userId));
    }
    const results = await Promise.all(queries);
    return {
      assignedEvents: results[0].count ?? 0,
      comments: results[1].count ?? 0,
      createdEvents: userId ? (results[2]?.count ?? 0) : 0,
      updatedEvents: userId ? (results[3]?.count ?? 0) : 0,
    };
  }

  // consume 済アカウントの削除: API 経由で auth.users を消す + 残った
  // staff_invitations 行も合わせて削除 (履歴 不要のため)。
  async function handleDeleteAccount(
    token: string,
    userId: string,
    displayName: string
  ) {
    const counts = await fetchUsageCounts(displayName, userId);
    if (!confirm(
      `「${displayName}」のアカウントを完全に削除しますか？\n\n` +
      `■ このスタッフの過去データ:\n` +
      `・担当者として記録された予定: ${counts.assignedEvents} 件 (表示は維持)\n` +
      `・作成した予定: ${counts.createdEvents} 件 → 「作成者: 不明」になります\n` +
      `・最終編集した予定: ${counts.updatedEvents} 件 → 「編集者: 不明」になります\n` +
      `・投稿したコメント: ${counts.comments} 件 (表示は維持)\n\n` +
      `■ 削除後:\n` +
      `・このスタッフはログインできなくなります\n` +
      `・members 一覧の表示名は残ります\n\n` +
      `本当に削除する場合のみ OK を押してください。`
    )) return;

    try {
      const res = await fetch("/api/admin/staff/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          unauthenticated: "ログインセッションが切れました。再ログインしてください。",
          permission_denied: "このアカウントを削除する権限がありません。",
          cannot_delete_self: "自分自身のアカウントは削除できません。",
          delete_failed: "削除に失敗しました。",
          target_lookup_failed: "対象ユーザーの取得に失敗しました。",
          service_key_missing: "サーバ設定エラー (管理者にお問合せください)。",
        };
        alert(messages[json.error] ?? `エラー: ${json.error ?? res.statusText}`);
        return;
      }

      // 削除成功 → staff_invitations も合わせて消す
      const supabase = getSupabase();
      await supabase.from("staff_invitations").delete().eq("token", token);

      reload();
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }

  // 停止: auth.users ban + members.status='inactive' + payroll_employees 退職処理
  async function handleStop(userId: string, displayName: string) {
    const counts = await fetchUsageCounts(displayName, userId);
    if (!confirm(
      `「${displayName}」のアカウントを停止しますか？\n\n` +
      `■ このスタッフの過去データ:\n` +
      `・担当者として記録された予定: ${counts.assignedEvents} 件 (表示維持)\n` +
      `・作成した予定: ${counts.createdEvents} 件 (作成者表示維持)\n` +
      `・最終編集した予定: ${counts.updatedEvents} 件 (編集者表示維持)\n` +
      `・投稿したコメント: ${counts.comments} 件 (表示維持)\n\n` +
      `■ 停止後:\n` +
      `・このスタッフはログインできなくなります\n` +
      `・members 一覧の status が 'inactive' (担当者 picker から除外)\n` +
      `・payroll_employees の在職区分が「退職者」+ 退職日=今日\n` +
      `・過去の予定・給与履歴は全て無傷で残ります\n\n` +
      `「復帰」ボタンでいつでも再活性化可能です。`
    )) return;
    try {
      const res = await fetch("/api/admin/staff/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`停止に失敗しました: ${json.error ?? res.statusText}`);
        return;
      }
      reload();
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }

  // パスワードリセット: 新パスワード生成 + 強制変更 flag set
  async function handleResetPassword(userId: string, displayName: string) {
    if (!confirm(
      `「${displayName}」のパスワードをリセットしますか？\n\n` +
      `・新しいパスワードがランダム生成されます\n` +
      `・本人は次回ログイン時に強制でパスワード変更を求められます\n` +
      `・新パスワードはこの画面に 1 度だけ表示されます (本人に伝達してください)`
    )) return;
    try {
      const res = await fetch("/api/admin/staff/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`リセット失敗: ${json.error ?? res.statusText}`);
        return;
      }
      // 新パスワードを表示する modal を出すのが理想だが、まずはシンプルに alert
      window.prompt(
        `「${displayName}」の新パスワード (この画面を閉じると 2 度と表示されません):`,
        json.password,
      );
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }

  // 復帰: 停止状態から再活性化
  async function handleRestore(userId: string, displayName: string) {
    if (!confirm(`「${displayName}」のアカウントを復帰させますか？\n\n・login 可能に戻る\n・members.status='active' / payroll の在職区分=「在職者」`)) return;
    try {
      const res = await fetch("/api/admin/staff/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`復帰に失敗しました: ${json.error ?? res.statusText}`);
        return;
      }
      reload();
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }

  // Phase 11c: 承認待ち端末を承認 / 拒否
  async function handleApproveDevice(deviceUuid: string, deviceLabel: string | null, userName: string | null) {
    if (!confirm(
      `「${userName ?? "?"}」の端末「${deviceLabel ?? "?"}」を承認しますか?\n\n` +
      `承認後、その端末からの Passkey ログインが可能になります。`
    )) return;
    try {
      const res = await fetch("/api/admin/devices/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_id_uuid: deviceUuid }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`承認失敗: ${json.error ?? res.statusText}`);
        return;
      }
      reload();
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }
  async function handleRevokeDevice(deviceUuid: string, deviceLabel: string | null, userName: string | null) {
    if (!confirm(
      `「${userName ?? "?"}」の端末「${deviceLabel ?? "?"}」を拒否しますか?\n\n` +
      `拒否すると、その端末からは今後ログインできなくなります。`
    )) return;
    try {
      const res = await fetch("/api/admin/devices/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_id_uuid: deviceUuid }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`拒否失敗: ${json.error ?? res.statusText}`);
        return;
      }
      reload();
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }

  // Phase 11: 2 台目 Passkey 登録許可を発行 (1 時間有効)
  async function handlePasskeyGrant(userId: string, displayName: string) {
    const reason = window.prompt(
      `「${displayName}」に 2 台目以降の Passkey 登録を許可します。\n` +
      `理由をメモしておく場合は入力してください (任意):`,
      ""
    );
    if (reason === null) return; // cancel
    try {
      const res = await fetch("/api/admin/passkey/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_user_id: userId, reason: reason.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`発行失敗: ${json.error ?? res.statusText}`);
        return;
      }
      const expires = new Date(json.expires_at).toLocaleString("ja-JP");
      alert(
        `「${displayName}」に追加 Passkey 登録を許可しました。\n\n` +
        `有効期限: ${expires} (1 時間)\n\n` +
        `スタッフは新端末で /settings/passkey を開き「新規登録」を押してください。`
      );
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }

  // Phase 11: Passkey を全削除 (= ID/PW ログインに戻す / 紛失時用)
  async function handlePasskeyRevokeAll(userId: string, displayName: string) {
    if (!confirm(
      `「${displayName}」の Passkey を全て削除しますか？\n\n` +
      `・端末紛失や機種変更時に使います\n` +
      `・削除後はその user は ID/パスワードでログイン可能に戻ります\n` +
      `・本人は新端末で Passkey を再登録できます (1 台目なので grant 不要)`
    )) return;
    try {
      const res = await fetch("/api/admin/passkey/revoke-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`削除失敗: ${json.error ?? res.statusText}`);
        return;
      }
      alert(`「${displayName}」の Passkey を ${json.deleted_count} 件削除しました。`);
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }

  // Phase 9-4: 別事業所追加
  async function handleAddOffice(userId: string, memberId: string, officeId: string) {
    try {
      const res = await fetch("/api/admin/staff/add-office", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, member_id: memberId, office_id: officeId }),
      });
      const json = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          unauthenticated: "ログインセッションが切れました。再ログインしてください。",
          permission_denied: "この事業所を追加する権限がありません (office_admin 以上が必要)。",
          already_assigned: "既にこの事業所に所属しています。",
          service_key_missing: "サーバ設定エラー (管理者にお問合せください)。",
        };
        alert(messages[json.error] ?? `エラー: ${json.error ?? res.statusText}`);
        return false;
      }
      reload();
      return true;
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
      return false;
    }
  }

  // Phase 9-4: 別事業所削除 (primary は不可)
  async function handleRemoveOffice(userId: string, memberId: string, officeId: string, officeName: string) {
    if (!confirm(`「${officeName}」への所属を解除しますか？\n\n・この事業所での担当・ログイン権限が失われます\n・予定の表示は影響しません`)) return;
    try {
      const res = await fetch("/api/admin/staff/remove-office", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, member_id: memberId, office_id: officeId }),
      });
      const json = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          unauthenticated: "ログインセッションが切れました。再ログインしてください。",
          permission_denied: "この事業所を解除する権限がありません。",
          cannot_remove_primary: "主所属の事業所は解除できません。先に別事業所を主所属に切替えてください。",
          service_key_missing: "サーバ設定エラー (管理者にお問合せください)。",
        };
        alert(messages[json.error] ?? `エラー: ${json.error ?? res.statusText}`);
        return;
      }
      reload();
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    }
  }

  // dangling 招待の履歴削除: auth.users は既に存在しないので、
  // staff_invitations 行だけを直接 DELETE する。
  // RLS: staff_invitations_admin_delete (group_admin or office_admin で自分の office) が enforce。
  async function handleDeleteHistory(token: string, displayName: string) {
    const counts = await fetchUsageCounts(displayName, null);
    if (!confirm(
      `「${displayName}」の招待履歴を削除しますか？\n\n` +
      `■ このスタッフの過去データ (アカウント削除済のため作成者情報は既に「不明」):\n` +
      `・担当者として記録された予定: ${counts.assignedEvents} 件 (表示は維持)\n` +
      `・投稿したコメント: ${counts.comments} 件 (表示は維持)\n\n` +
      `■ 削除後:\n` +
      `・staff_invitations の履歴行のみが消えます\n` +
      `・members 一覧の表示名は残ります\n\n` +
      `本当に削除する場合のみ OK を押してください。`
    )) return;
    const supabase = getSupabase();
    const { error: deleteError } = await supabase
      .from("staff_invitations")
      .delete()
      .eq("token", token);
    if (deleteError) {
      alert(`履歴削除に失敗しました: ${deleteError.message}`);
      return;
    }
    reload();
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-white">
        <Loader2 size={28} className="animate-spin text-indigo-400" />
      </div>
    );
  }

  if (!authUser) return null; // redirect 中

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white">
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-500"
            title="戻る"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-800">スタッフ管理</h1>
            <p className="text-xs text-gray-400">招待の発行・取消</p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            disabled={offices.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg"
          >
            <Plus size={14} />
            新規招待
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-600 flex items-start gap-2">
            <TriangleAlert size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Phase 11c: 承認待ち端末 */}
        {pendingDevices.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-amber-100 flex items-center gap-2">
              <Fingerprint size={14} className="text-amber-600" />
              <h2 className="text-xs font-semibold text-amber-700">
                承認待ち端末 ({pendingDevices.length})
              </h2>
            </div>
            <ul className="divide-y divide-amber-100">
              {pendingDevices.map((d) => (
                <li key={d.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {d.user_display_name ?? "(名前未取得)"} — {d.device_label ?? "端末"}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {new Date(d.created_at).toLocaleString("ja-JP")}
                      {d.first_seen_ip ? ` / IP ${d.first_seen_ip}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => handleApproveDevice(d.id, d.device_label, d.user_display_name)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-semibold"
                  >
                    承認
                  </button>
                  <button
                    onClick={() => handleRevokeDevice(d.id, d.device_label, d.user_display_name)}
                    className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-semibold"
                  >
                    拒否
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
          </div>
        ) : invitations.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
            <UserPlus size={32} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-400">招待はまだありません</p>
            <p className="text-xs text-gray-300 mt-1">「新規招待」から発行してください</p>
          </div>
        ) : (
          <ul className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 overflow-hidden">
            {invitations.map((inv) => (
              <InvitationRow
                key={inv.token}
                inv={inv}
                offices={offices}
                onCancelInvitation={handleCancelInvitation}
                onDeleteAccount={handleDeleteAccount}
                onDeleteHistory={handleDeleteHistory}
                onStop={handleStop}
                onRestore={handleRestore}
                onResetPassword={handleResetPassword}
                onAddOffice={handleAddOffice}
                onRemoveOffice={handleRemoveOffice}
                onPasskeyGrant={handlePasskeyGrant}
                onPasskeyRevokeAll={handlePasskeyRevokeAll}
              />
            ))}
          </ul>
        )}

        <p className="text-xs text-gray-400 leading-relaxed px-1">
          招待 URL と初期パスワードは発行直後に <strong>1 回だけ</strong> 表示されます。
          コピーして招待先に渡してください（SMS / 紙 / 対面口頭など、安全な経路で）。
          紛失した場合は招待を取り消して再発行してください。
        </p>
      </main>

      {showNewModal && (
        <NewInvitationModal
          offices={offices}
          onClose={() => setShowNewModal(false)}
          onIssued={(result) => {
            setShowNewModal(false);
            setIssued(result);
            reload();
          }}
        />
      )}

      {issued && (
        <IssuedModal issued={issued} onClose={() => setIssued(null)} />
      )}
    </div>
  );
}

// ── 一覧の 1 行 ────────────────────────────────────────────────────
function InvitationRow({
  inv,
  offices,
  onCancelInvitation,
  onDeleteAccount,
  onDeleteHistory,
  onStop,
  onRestore,
  onResetPassword,
  onAddOffice,
  onRemoveOffice,
  onPasskeyGrant,
  onPasskeyRevokeAll,
}: {
  inv: InvitationListItem;
  offices: OfficeOption[];
  onCancelInvitation: (token: string, displayName: string) => void;
  onDeleteAccount: (token: string, userId: string, displayName: string) => void;
  onDeleteHistory: (token: string, displayName: string) => void;
  onStop: (userId: string, displayName: string) => void;
  onRestore: (userId: string, displayName: string) => void;
  onResetPassword: (userId: string, displayName: string) => void;
  onAddOffice: (userId: string, memberId: string, officeId: string) => Promise<boolean>;
  onRemoveOffice: (userId: string, memberId: string, officeId: string, officeName: string) => void;
  onPasskeyGrant: (userId: string, displayName: string) => void;
  onPasskeyRevokeAll: (userId: string, displayName: string) => void;
}) {
  const [showAddOfficeModal, setShowAddOfficeModal] = useState(false);
  const expired = new Date(inv.expires_at) <= new Date();
  const consumed = inv.consumed_at !== null;
  // dangling = 使用済だが consumed_user_id が NULL (auth.users が手動削除されると
  // FK ON DELETE SET NULL で NULL 化)。アカウント削除 button は出せないので、
  // 履歴行 (staff_invitations) を直接消す button を出す。
  const dangling = consumed && !inv.consumed_user_id;
  const stopped = inv.member_status === "inactive";
  const status = !consumed
    ? expired
      ? { label: "期限切れ", color: "bg-amber-50 text-amber-600" }
      : { label: "未使用", color: "bg-emerald-50 text-emerald-600" }
    : dangling
    ? { label: "削除済", color: "bg-gray-100 text-gray-400" }
    : stopped
    ? { label: "停止中", color: "bg-orange-50 text-orange-600" }
    : { label: "在職", color: "bg-emerald-50 text-emerald-600" };

  // Phase 9-4: consume 済 + member_id 在 → 複数 office UI を出す
  const showMultiOfficeUI =
    consumed && !!inv.consumed_user_id && !!inv.member_id;
  const assignedOfficeIdsSet = new Set(
    inv.member_office_assignments.map((a) => a.office_id)
  );
  // 追加候補: admin 範囲の office から 既に紐付いてるものを除外
  const candidateOffices = offices.filter((o) => !assignedOfficeIdsSet.has(o.id));

  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <div className="w-9 h-9 bg-indigo-50 rounded-full flex items-center justify-center shrink-0">
        <UserPlus size={16} className="text-indigo-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800 truncate">{inv.display_name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${status.color}`}>{status.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
            {inv.role === "office_admin" ? "事業所管理者" : "メンバー"}
          </span>
        </div>
        <div className="text-xs text-gray-400 truncate flex items-center gap-1.5 mt-0.5">
          <Building2 size={11} />
          <span>{inv.office_name ?? inv.office_id}</span>
          <span className="text-gray-300">·</span>
          <Clock size={11} />
          <span>
            {consumed
              ? `${formatDistanceToNow(new Date(inv.consumed_at as string), { locale: ja, addSuffix: true })} に使用`
              : expired
              ? `${formatDistanceToNow(new Date(inv.expires_at), { locale: ja, addSuffix: true })} に期限切れ`
              : `${formatDistanceToNow(new Date(inv.expires_at), { locale: ja, addSuffix: true })} に期限切れ`}
          </span>
        </div>
        {showMultiOfficeUI && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {inv.member_office_assignments.length === 0 ? (
              <span className="text-[10px] text-gray-300 italic">所属事業所がありません</span>
            ) : (
              inv.member_office_assignments.map((a) => (
                <span
                  key={a.office_id}
                  className={`inline-flex items-center gap-1 text-[10px] pl-2 pr-1 py-0.5 rounded-full border ${
                    a.is_primary
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-bold"
                      : "bg-gray-50 border-gray-200 text-gray-600"
                  }`}
                  title={a.is_primary ? "主所属 (削除不可)" : "副所属"}
                >
                  {a.is_primary && <Star size={10} className="text-indigo-500 fill-indigo-400" />}
                  <span className="max-w-[120px] truncate">{a.office_name ?? a.office_id}</span>
                  {a.is_primary ? (
                    <span className="w-4" />
                  ) : (
                    <button
                      onClick={() =>
                        onRemoveOffice(
                          inv.consumed_user_id!,
                          inv.member_id!,
                          a.office_id,
                          a.office_name ?? a.office_id
                        )
                      }
                      className="w-4 h-4 rounded-full hover:bg-red-100 text-gray-400 hover:text-red-500 flex items-center justify-center"
                      title="この事業所から外す"
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))
            )}
            {candidateOffices.length > 0 && (
              <button
                onClick={() => setShowAddOfficeModal(true)}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 font-semibold"
                title="別の事業所にも所属させる"
              >
                <Plus size={10} />
                別事業所追加
              </button>
            )}
          </div>
        )}
      </div>
      {!consumed ? (
        <button
          onClick={() => onCancelInvitation(inv.token, inv.display_name)}
          className="p-2 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"
          title="招待を取り消す (URL 無効化)"
        >
          <Trash2 size={14} />
        </button>
      ) : dangling ? (
        <button
          onClick={() => onDeleteHistory(inv.token, inv.display_name)}
          className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 text-[11px] font-semibold flex items-center gap-1"
          title="このアカウントは既に削除済 (auth.users 不在)。招待履歴行を消します"
        >
          <Trash2 size={11} />
          履歴削除
        </button>
      ) : inv.consumed_user_id ? (
        <div className="flex items-center gap-1">
          {!stopped && (
            <button
              onClick={() => onResetPassword(inv.consumed_user_id!, inv.display_name)}
              className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-300 hover:text-indigo-500"
              title="パスワードをリセット (新 pw が画面に 1 度表示される)"
            >
              <Lock size={12} />
            </button>
          )}
          {/* Phase 11: Passkey 管理 */}
          {!stopped && (
            <>
              <button
                onClick={() => onPasskeyGrant(inv.consumed_user_id!, inv.display_name)}
                className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-300 hover:text-amber-500"
                title="2 台目以降の Passkey 登録を 1 時間許可 (機種変・追加端末用)"
              >
                <Fingerprint size={12} />
              </button>
              <button
                onClick={() => onPasskeyRevokeAll(inv.consumed_user_id!, inv.display_name)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500"
                title="Passkey を全削除 (紛失時 / ID/PW ログインに戻す)"
              >
                <ShieldOff size={12} />
              </button>
            </>
          )}
          {stopped ? (
            <button
              onClick={() => onRestore(inv.consumed_user_id!, inv.display_name)}
              className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 text-[11px] font-semibold"
              title="停止状態を解除して復帰させる"
            >
              復帰
            </button>
          ) : (
            <button
              onClick={() => onStop(inv.consumed_user_id!, inv.display_name)}
              className="px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-600 text-[11px] font-semibold"
              title="login 不可化 + 在職区分を退職に (過去データ保護)"
            >
              停止
            </button>
          )}
          <button
            onClick={() => onDeleteAccount(inv.token, inv.consumed_user_id!, inv.display_name)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500"
            title="完全削除 (再ログイン不可、作成者表示が NULL に。通常は「停止」推奨)"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ) : null}
      {showAddOfficeModal && inv.consumed_user_id && inv.member_id && (
        <AddOfficeModal
          displayName={inv.display_name}
          candidateOffices={candidateOffices}
          onClose={() => setShowAddOfficeModal(false)}
          onConfirm={async (officeId) => {
            const ok = await onAddOffice(inv.consumed_user_id!, inv.member_id!, officeId);
            if (ok) setShowAddOfficeModal(false);
          }}
        />
      )}
    </li>
  );
}

// ── Phase 9-4: 別事業所追加モーダル ─────────────────────────────────
function AddOfficeModal({
  displayName,
  candidateOffices,
  onClose,
  onConfirm,
}: {
  displayName: string;
  candidateOffices: OfficeOption[];
  onClose: () => void;
  onConfirm: (officeId: string) => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<string>(candidateOffices[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  // tenant でグループ化 (NewInvitationModal と同じ手法)
  const grouped = useMemo(() => {
    const map = new Map<string, { tenantName: string | null; items: OfficeOption[] }>();
    for (const o of candidateOffices) {
      const key = o.tenant_id;
      const entry = map.get(key) ?? { tenantName: o.tenant_name, items: [] };
      entry.items.push(o);
      map.set(key, entry);
    }
    return Array.from(map.entries());
  }, [candidateOffices]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Building2 size={16} className="text-emerald-500" />
            <h2 className="text-sm font-bold text-gray-800">別事業所を追加</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            「<strong>{displayName}</strong>」を追加で所属させる事業所を選択してください。
            <br />
            主所属は変わりません (副所属として追加されます)。
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">追加する事業所</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 bg-white"
            >
              {grouped.map(([tenantId, { tenantName, items }]) => (
                <optgroup key={tenantId} label={tenantName ?? tenantId}>
                  {items.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            キャンセル
          </button>
          <button
            onClick={async () => {
              if (!selected) return;
              setSubmitting(true);
              try {
                await onConfirm(selected);
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting || !selected}
            className="flex items-center gap-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}
            追加
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── 新規招待モーダル ────────────────────────────────────────────────
function NewInvitationModal({
  offices,
  onClose,
  onIssued,
}: {
  offices: OfficeOption[];
  onClose: () => void;
  onIssued: (result: {
    invite_url: string;
    initial_password: string;
    display_name: string;
    login_id: string | null;
    login_id_was_renamed: boolean;
    expires_at: string | null;
  }) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [loginIdInput, setLoginIdInput] = useState("");  // 任意。空ならサーバ側で表示名から自動派生 (ASCII 抜出)。
  const [officeId, setOfficeId] = useState(offices[0]?.id ?? "");
  const [role, setRole] = useState<"office_admin" | "member">("member");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // tenant でグループ化
  const grouped = useMemo(() => {
    const map = new Map<string, { tenantName: string | null; items: OfficeOption[] }>();
    for (const o of offices) {
      const key = o.tenant_id;
      const entry = map.get(key) ?? { tenantName: o.tenant_name, items: [] };
      entry.items.push(o);
      map.set(key, entry);
    }
    return Array.from(map.entries());
  }, [offices]);

  async function submit() {
    if (!displayName.trim() || !officeId) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/admin/invite-staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          office_id: officeId,
          role,
          // 空文字なら body で省略 (サーバ側で表示名から自動派生)
          ...(loginIdInput.trim() ? { login_id: loginIdInput.trim().toLowerCase() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          unauthenticated: "ログインセッションが切れました。再ログインしてください。",
          office_not_allowed: "この事業所への招待権限がありません（office_admin 以上が必要）。",
          display_name_invalid: "表示名が不正です（1〜64 文字）。",
          office_id_invalid: "事業所が選択されていません。",
          role_invalid: "ロールが不正です。",
          login_id_invalid: "ログイン ID は英小文字で始まり、4〜24 文字（英小・数字・ピリオド・ハイフン可）にしてください。",
          login_id_required: "表示名から ID を自動派生できませんでした。ログイン ID を明示的に入力してください。",
          login_id_dedup_exhausted: "同じ login_id が大量に使われていて連番候補を使い切りました。別の base を試してください。",
          insert_failed: "招待の発行に失敗しました（権限不足の可能性）。",
          permission_check_failed: "権限チェックに失敗しました。",
          service_key_missing: "サーバ設定エラー (管理者にお問合せください)。",
          list_users_failed: "既存ユーザの取得に失敗しました。",
        };
        setErrorMsg(messages[json.error] ?? `エラー: ${json.error ?? res.statusText}`);
        return;
      }
      onIssued({
        invite_url: json.invite_url,
        initial_password: json.initial_password,
        display_name: displayName.trim(),
        login_id: json.login_id ?? null,
        login_id_was_renamed: !!json.login_id_was_renamed,
        expires_at: json.expires_at ?? null,
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-indigo-500" />
            <h2 className="text-sm font-bold text-gray-800">スタッフを招待</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">表示名（必須）</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例: 佐藤花子"
              maxLength={64}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              members 一覧やカレンダー上での表示に使われます。重複可。
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              ログイン ID（任意）
            </label>
            <input
              type="text"
              value={loginIdInput}
              onChange={(e) => setLoginIdInput(e.target.value.toLowerCase())}
              placeholder="例: kawashima  (空欄なら自動)"
              maxLength={24}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 font-mono"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              英小文字始まり 4〜24 字（英小・数字・ピリオド・ハイフン）。
              <br />
              空欄なら表示名の英字から自動派生。重複時は <code>kawashima2</code> のように連番付与。
              <br />
              ※ ここで決まった ID をスタッフに伝えてください（次回以降のログインに必要）。
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">所属事業所</label>
            <select
              value={officeId}
              onChange={(e) => setOfficeId(e.target.value)}
              className="w-full text-sm border-2 border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 bg-white"
            >
              {grouped.map(([tenantId, { tenantName, items }]) => (
                <optgroup key={tenantId} label={tenantName ?? tenantId}>
                  {items.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ロール</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "member", label: "メンバー", desc: "現場スタッフ" },
                { v: "office_admin", label: "事業所管理者", desc: "所長権限" },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setRole(opt.v)}
                  className={`text-left px-3 py-2 rounded-xl border-2 transition-colors ${
                    role === opt.v ? "border-indigo-400 bg-indigo-50/50" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-800">{opt.label}</div>
                  <div className="text-[10px] text-gray-400">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {errorMsg && (
            <div className="text-xs bg-red-50 text-red-600 border border-red-100 rounded-xl p-2.5">
              {errorMsg}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={submitting || !displayName.trim() || !officeId}
            className="flex items-center gap-1 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}
            招待を発行
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── 発行直後の表示モーダル（URL + 初期 PW を 1 回だけ表示）────────────
function IssuedModal({
  issued,
  onClose,
}: {
  issued: {
    invite_url: string;
    initial_password: string;
    display_name: string;
    login_id: string | null;
    login_id_was_renamed: boolean;
    expires_at: string | null;
  };
  onClose: () => void;
}) {
  const [copiedField, setCopiedField] = useState<"url" | "pw" | "id" | "both" | null>(null);

  async function copy(text: string, field: "url" | "pw" | "id" | "both") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      alert("コピーに失敗しました。手動で選択してください。");
    }
  }

  const combinedText = issued.login_id
    ? `招待リンク: ${issued.invite_url}\nログイン ID: ${issued.login_id}\n初期パスワード: ${issued.initial_password}`
    : `招待リンク: ${issued.invite_url}\n初期パスワード: ${issued.initial_password}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
        <header className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-emerald-50">
          <Check size={16} className="text-emerald-500" />
          <h2 className="text-sm font-bold text-gray-800">
            「{issued.display_name}」の招待を発行しました
          </h2>
        </header>

        <div className="p-5 space-y-3">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-start gap-2">
            <Lock size={14} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 leading-relaxed">
              この内容は <strong>このタイミングでしか表示されません</strong>。
              閉じる前に必ず控えて、招待先に安全な経路（SMS / 対面 / 紙など）で渡してください。
            </p>
          </div>

          <CopyableField
            label="招待 URL"
            value={issued.invite_url}
            mono
            onCopy={() => copy(issued.invite_url, "url")}
            copied={copiedField === "url"}
          />
          {issued.login_id && (
            <>
              <CopyableField
                label={
                  issued.login_id_was_renamed
                    ? `ログイン ID  (希望が重複していたため自動リネーム)`
                    : "ログイン ID"
                }
                value={issued.login_id}
                mono
                onCopy={() => copy(issued.login_id!, "id")}
                copied={copiedField === "id"}
              />
              {issued.login_id_was_renamed && (
                <p className="text-[10px] text-amber-600 -mt-2">
                  既に同じ ID が使われていたので末尾に番号を付与しました。
                </p>
              )}
            </>
          )}
          <CopyableField
            label="初期パスワード"
            value={issued.initial_password}
            mono
            onCopy={() => copy(issued.initial_password, "pw")}
            copied={copiedField === "pw"}
          />

          <button
            onClick={() => copy(combinedText, "both")}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-semibold rounded-xl"
          >
            {copiedField === "both" ? <Check size={12} /> : <Copy size={12} />}
            {copiedField === "both" ? "コピーしました" : "URL とパスワードを両方コピー"}
          </button>

          {issued.expires_at && (
            <p className="text-[10px] text-gray-400 text-center">
              有効期限: {format(new Date(issued.expires_at), "yyyy/MM/dd HH:mm", { locale: ja })}
            </p>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex justify-end bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold rounded-lg"
          >
            控えました（閉じる）
          </button>
        </footer>
      </div>
    </div>
  );
}

function CopyableField({
  label,
  value,
  mono,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 mb-1 block">{label}</label>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          className={`flex-1 text-xs border-2 border-gray-200 rounded-xl px-3 py-2 bg-gray-50 ${
            mono ? "font-mono" : ""
          }`}
        />
        <button
          onClick={onCopy}
          className="px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500"
          title="コピー"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

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
  Loader2,
  Lock,
  Plus,
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
    expires_at: string | null;
  } | null>(null);

  // 認証ガード
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then((res: { data: { user: User | null } }) => {
      const u = res.data.user ?? null;
      setAuthUser(u);
      setAuthChecked(true);
      if (!u) router.replace("/login?next=/admin/staff");
    });
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
        .select("token, display_name, office_id, role, created_at, expires_at, consumed_at")
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
      };
      setInvitations(
        ((invRows ?? []) as InvRow[]).map((r) => ({
          token: r.token,
          display_name: r.display_name,
          office_id: r.office_id,
          office_name: officeNameById.get(r.office_id) ?? null,
          role: r.role,
          created_at: r.created_at,
          expires_at: r.expires_at,
          consumed_at: r.consumed_at,
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
    reload();
  }, [authChecked, authUser]);

  async function handleDelete(token: string, displayName: string) {
    if (!confirm(`「${displayName}」の招待を取り消しますか？\n（既に使用された招待は履歴として残ります）`)) return;
    const supabase = getSupabase();
    const { error: deleteError } = await supabase
      .from("staff_invitations")
      .delete()
      .eq("token", token);
    if (deleteError) {
      alert(`削除に失敗しました: ${deleteError.message}`);
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
              <InvitationRow key={inv.token} inv={inv} onDelete={handleDelete} />
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
  onDelete,
}: {
  inv: InvitationListItem;
  onDelete: (token: string, displayName: string) => void;
}) {
  const expired = new Date(inv.expires_at) <= new Date();
  const consumed = inv.consumed_at !== null;
  const status = consumed
    ? { label: "使用済", color: "bg-gray-100 text-gray-500" }
    : expired
    ? { label: "期限切れ", color: "bg-amber-50 text-amber-600" }
    : { label: "未使用", color: "bg-emerald-50 text-emerald-600" };

  return (
    <li className="px-4 py-3 flex items-center gap-3">
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
      </div>
      {!consumed && (
        <button
          onClick={() => onDelete(inv.token, inv.display_name)}
          className="p-2 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"
          title="取り消し"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
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
    expires_at: string | null;
  }) => void;
}) {
  const [displayName, setDisplayName] = useState("");
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
          insert_failed: "招待の発行に失敗しました（権限不足の可能性）。",
          permission_check_failed: "権限チェックに失敗しました。",
        };
        setErrorMsg(messages[json.error] ?? `エラー: ${json.error ?? res.statusText}`);
        return;
      }
      onIssued({
        invite_url: json.invite_url,
        initial_password: json.initial_password,
        display_name: displayName.trim(),
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
  issued: { invite_url: string; initial_password: string; display_name: string; expires_at: string | null };
  onClose: () => void;
}) {
  const [copiedField, setCopiedField] = useState<"url" | "pw" | "both" | null>(null);

  async function copy(text: string, field: "url" | "pw" | "both") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      alert("コピーに失敗しました。手動で選択してください。");
    }
  }

  const combinedText = `招待リンク: ${issued.invite_url}\n初期パスワード: ${issued.initial_password}`;

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

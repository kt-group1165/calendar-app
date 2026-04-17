"use client";

import { useState, useEffect } from "react";
import { UserPlus, Loader2, Trash2, Crown, User, Mail } from "lucide-react";
import { getTenantUsers, updateUserRole, removeUserFromTenant, type TenantUser, type Role } from "@/lib/users";
import { getMembers, type Member } from "@/lib/members";

type Props = { tenantId: string };

export default function UsersTab({ tenantId }: Props) {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviteMemberId, setInviteMemberId] = useState<string>("");
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const [u, m] = await Promise.all([
        getTenantUsers(tenantId),
        getMembers(tenantId),
      ]);
      setUsers(u);
      setMembers(m);
    } catch {
      setMessage({ type: "error", text: "読み込みに失敗しました。マスター権限が必要です。" });
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          tenantId,
          role: inviteRole,
          memberId: inviteMemberId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: json.error || "招待に失敗しました" });
      } else {
        setMessage({
          type: "success",
          text: json.kind === "invited" ? "📧 招待メールを送信しました" : "✅ 既存ユーザーを追加しました",
        });
        setInviteEmail("");
        setInviteMemberId("");
        setInviteRole("member");
        await load();
      }
    } catch {
      setMessage({ type: "error", text: "ネットワークエラー" });
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: Role) {
    try {
      await updateUserRole(userId, tenantId, newRole);
      setUsers((prev) => prev.map((u) => u.user_id === userId ? { ...u, role: newRole } : u));
    } catch {
      alert("ロール変更に失敗しました");
    }
  }

  async function handleRemove(userId: string, label: string) {
    if (!confirm(`${label} をこのテナントから外しますか？（Auth アカウントは残ります）`)) return;
    try {
      await removeUserFromTenant(userId, tenantId);
      setUsers((prev) => prev.filter((u) => u.user_id !== userId));
    } catch {
      alert("削除に失敗しました");
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* 招待フォーム */}
      <div className="border-2 border-indigo-100 bg-indigo-50/50 rounded-xl p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <UserPlus size={16} className="text-indigo-500" />
          <p className="text-sm font-semibold text-indigo-700">ユーザーを招待</p>
        </div>
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="メールアドレス"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400 bg-white"
          >
            <option value="member">一般メンバー</option>
            <option value="master">管理者（master）</option>
          </select>
          <select
            value={inviteMemberId}
            onChange={(e) => setInviteMemberId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400 bg-white"
          >
            <option value="">メンバー未紐付け</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name} に紐付け</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleInvite}
          disabled={inviting || !inviteEmail.trim()}
          className="w-full py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm"
        >
          {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
          招待を送信
        </button>
        {message && (
          <p className={`text-xs p-2 rounded-lg ${
            message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
          }`}>
            {message.text}
          </p>
        )}
      </div>

      {/* ユーザー一覧 */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">このテナントのユーザー</p>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">ユーザーがいません</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.user_id} className="bg-gray-50 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  u.role === "master" ? "bg-amber-100" : "bg-indigo-100"
                }`}>
                  {u.role === "master"
                    ? <Crown size={14} className="text-amber-600" />
                    : <User size={14} className="text-indigo-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {u.member_name ?? "（メンバー未紐付け）"}
                  </p>
                  <p className="text-xs text-gray-400 truncate font-mono">{u.user_id.slice(0, 8)}…</p>
                </div>
                <select
                  value={u.role}
                  onChange={(e) => handleRoleChange(u.user_id, e.target.value as Role)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white shrink-0"
                >
                  <option value="member">member</option>
                  <option value="master">master</option>
                </select>
                <button
                  onClick={() => handleRemove(u.user_id, u.member_name ?? "このユーザー")}
                  className="p-1.5 text-gray-300 hover:text-red-400 rounded-lg hover:bg-red-50 shrink-0"
                  title="このテナントから外す"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

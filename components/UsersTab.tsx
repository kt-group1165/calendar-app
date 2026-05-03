"use client";

import { Users, Construction } from "lucide-react";

// 旧テナント単位の master/member 招待 UI は Phase 2-5b で廃止。
// 後継は Phase 2-7 で構築するスタッフ招待 UI（office 単位、自前トークン方式）。
// 設計詳細：HANDOVER_NEXT_SESSION.md §13、PHASE_2_5_RLS_DESIGN.md §6

type Props = { tenantId: string };

export default function UsersTab(_props: Props) {
  return (
    <div className="p-4 space-y-4">
      <div className="border-2 border-amber-100 bg-amber-50/50 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Construction size={18} className="text-amber-500" />
          <p className="text-sm font-semibold text-amber-700">
            ユーザー管理は Phase 2-7 で再実装中
          </p>
        </div>
        <p className="text-xs text-amber-700 leading-relaxed">
          旧テナント単位の招待機能は廃止しました。新しいスタッフ招待 UI は
          office 単位で自前トークン方式（メール不要、URL + 初期パスワード配布）
          として再構築予定です。
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          暫定的にユーザを追加する必要がある場合は、Supabase Studio から
          <code className="mx-1 px-1.5 py-0.5 bg-white rounded border border-gray-200 font-mono text-[10px]">
            user_offices
          </code>
          に直接 INSERT してください。
        </p>
      </div>

      <div className="text-center py-6 text-gray-300">
        <Users size={32} className="mx-auto mb-2 opacity-50" />
        <p className="text-xs">招待 UI は準備中です</p>
      </div>
    </div>
  );
}

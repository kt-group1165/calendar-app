"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// /passkeys は Phase 11c の本実装 (/settings/passkey — 端末承認 grant・
// device_id 連携込み) に統合済み。ホーム画面・[tenant] のメニューからの
// 既存リンク (router.push("/passkeys")) を直さなくて済むよう、薄い
// redirect として維持する。

export default function PasskeysRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/passkey");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-white">
      <Loader2 size={28} className="animate-spin text-indigo-400" />
    </div>
  );
}

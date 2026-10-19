import { createClient } from "@/lib/supabase-server";

// 日次バックアップ (app/api/backup) と、その一覧・ダウンロード (app/api/backup/files) の認可。
//   1. `Authorization: Bearer <CRON_SECRET>` ヘッダ → Vercel Cron 経由を許可
//      （CRON_SECRET env var を Vercel に設定）
//   2. 上記が無い場合、cookies の auth セッションを見て group_admin（domen）なら許可
//   3. それ以外 → 401 / 403
//
// backups バケットは非公開で policy も無い (中身は全事業所の予定 = 利用者名・住所を含む)。
// 画面からは直接読めないので、ここを通した API が service_role で読む。

export type BackupAuth =
  | { ok: true; via: "cron" | "user" }
  | { ok: false; status: number; message: string };

export async function authorizeBackup(request: Request, opts: { allowCron: boolean }): Promise<BackupAuth> {
  // 経路 1: CRON_SECRET ヘッダ照合
  const secret = process.env.CRON_SECRET;
  if (opts.allowCron && secret) {
    const auth = request.headers.get("authorization");
    if (auth === `Bearer ${secret}`) {
      return { ok: true, via: "cron" };
    }
  }

  // 経路 2: 認証セッション + group_admin 判定
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return { ok: false, status: 401, message: "unauthenticated" };
  }

  // group_admin かどうかは auth_admin_group_ids() rpc で確認
  // （1 行以上返れば group_admin）
  const { data: groupRows, error: rpcError } = await supabase.rpc(
    "auth_admin_group_ids"
  );
  if (rpcError) {
    return { ok: false, status: 500, message: "permission_check_failed" };
  }
  type Row = { auth_admin_group_ids?: string } | string;
  const groupIds = ((groupRows ?? []) as Row[]).filter((r) =>
    typeof r === "string" ? r.length > 0 : (r.auth_admin_group_ids ?? "").length > 0
  );
  if (groupIds.length === 0) {
    return { ok: false, status: 403, message: "group_admin_required" };
  }
  return { ok: true, via: "user" };
}

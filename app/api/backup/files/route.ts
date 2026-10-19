import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { authorizeBackup } from "@/lib/backup-auth";

// 自動バックアップの一覧とダウンロード (管理パネル > CSV)。group_admin だけ。
//   GET                → { files: [{ name, created_at }] } (新しい順)
//   GET ?file=<name>   → { url } 60 秒だけ有効なダウンロード URL

const FILE_RE = /^backup_all_\d{4}-\d{2}-\d{2}\.csv$/;

export async function GET(request: Request) {
  const auth = await authorizeBackup(request, { allowCron: false });
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const supabase = createAdminClient();
  const file = new URL(request.url).searchParams.get("file");

  if (file) {
    if (!FILE_RE.test(file)) return NextResponse.json({ error: "invalid_file" }, { status: 400 });
    const { data, error } = await supabase.storage.from("backups").createSignedUrl(file, 60, { download: file });
    if (error || !data) {
      console.error(`[backup/files] ダウンロード URL の発行に失敗 (${file}): ${error?.message}`);
      return NextResponse.json({ error: error?.message ?? "signed_url_failed" }, { status: 500 });
    }
    return NextResponse.json({ url: data.signedUrl });
  }

  const { data, error } = await supabase.storage
    .from("backups")
    .list("", { sortBy: { column: "name", order: "desc" }, limit: 100 });
  if (error) {
    console.error(`[backup/files] 一覧の取得に失敗: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const files = (data ?? [])
    .filter((f) => FILE_RE.test(f.name))
    .map((f) => ({ name: f.name, created_at: f.created_at ?? "" }));
  return NextResponse.json({ files });
}

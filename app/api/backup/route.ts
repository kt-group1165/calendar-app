import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase-server";

// バックアップは Vercel Cron から叩かれる想定。全テナント横断で全予定を取得
// するため、service_role キーで RLS をバイパスする必要がある。
//
// アクセス制御（Phase 2-7 で追加、それまで誰でも叩けた）：
//   1. `Authorization: Bearer <CRON_SECRET>` ヘッダ → Vercel Cron 経由を許可
//      （CRON_SECRET env var を Vercel に設定）
//   2. 上記が無い場合、cookies の auth セッションを見て group_admin（domen）
//      なら手動実行を許可
//   3. それ以外 → 401
//
// この 2 経路を許す理由：
//   - Cron は無人実行のため secret 方式が安全
//   - 手動 trigger（管理者がブラウザから叩く）も時々したいので auth 経路も残す

const CSV_HEADERS = [
  "ID","タイトル","開始日","終了日","開始時刻","終了時刻","終日",
  "用件種別","担当者","メモ","備考","住所","カラー","作成者","最終編集者","作成日時",
];

function escapeCell(v: string | null | undefined): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function formatJST(isoStr: string): string {
  const d = new Date(isoStr);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 16).replace("T", " ");
}

function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// 呼出元が「Cron 経由 (CRON_SECRET 一致) または group_admin」かを判定。
// 失敗時は { ok: false, status, message } を返す。
async function authorize(request: Request): Promise<
  { ok: true; via: "cron" | "user" } | { ok: false; status: number; message: string }
> {
  // 経路 1: CRON_SECRET ヘッダ照合
  const secret = process.env.CRON_SECRET;
  if (secret) {
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

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const supabase = createAdminClient();
    // 全予定を取得（1000件超対応・ページネーション）
    const PAGE = 1000;
    const allEvents = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .is("deleted_at", null)
        .order("start_date")
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      allEvents.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    const events = allEvents;

    // CSV生成
    const rows = (events ?? []).map((e) => [
      e.id,
      e.title,
      e.start_date,
      e.end_date,
      e.start_time?.slice(0, 5) ?? "",
      e.end_time?.slice(0, 5) ?? "",
      e.all_day ? "はい" : "いいえ",
      (e.event_type ?? []).join("・"),
      (e.assignees ?? []).join("・"),
      e.description ?? "",
      e.notes ?? "",
      e.location ?? "",
      e.color ?? "#6366f1",
      e.created_by ?? "",
      e.updated_by ?? "",
      formatJST(e.created_at),
    ]);

    const csv =
      "﻿" +
      [CSV_HEADERS, ...rows]
        .map((row) => row.map(escapeCell).join(","))
        .join("\n");

    // Supabase Storage の backups バケットにアップロード（全テナント合算）
    const fileName = `backup_all_${todayJST()}.csv`;
    const { error: uploadError } = await supabase.storage
      .from("backups")
      .upload(fileName, Buffer.from(csv, "utf-8"), {
        contentType: "text/csv;charset=utf-8",
        upsert: true, // 同じ日付なら上書き
      });

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      file: fileName,
      count: (events ?? []).length,
      via: auth.via,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

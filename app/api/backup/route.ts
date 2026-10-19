import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { authorizeBackup } from "@/lib/backup-auth";

// バックアップは Vercel Cron から叩かれる想定。全テナント横断で全予定を取得
// するため、service_role キーで RLS をバイパスする必要がある。
//
// アクセス制御（Phase 2-7 で追加、それまで誰でも叩けた）は lib/backup-auth.ts:
//   Vercel Cron (CRON_SECRET) か、ログイン中の group_admin だけ。
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

/** 失敗を Vercel のログに必ず残す (以前は 500 を返すだけで、5 か月失敗し続けても誰も気づかなかった) */
function fail(step: string, message: string) {
  console.error(`[backup] ${step} に失敗: ${message}`);
  return NextResponse.json({ error: message, step }, { status: 500 });
}

/** バックアップを残す日数。これより古い backup_all_YYYY-MM-DD.csv は消す */
const KEEP_DAYS = 60;

function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const auth = await authorizeBackup(request, { allowCron: true });
  if (!auth.ok) {
    // Cron からの 401 は CRON_SECRET 未設定・不一致のとき。気づけるようにログに出す
    console.error(`[backup] 認可に失敗: ${auth.status} ${auth.message}`);
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
      if (error) return fail("予定の読み込み", error.message);
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

    if (uploadError) return fail(`保存 (backups/${fileName})`, uploadError.message);

    // 古いバックアップを消す (保存に成功した後だけ。消し損ねても今日の分は残っているので失敗にはしない)
    const cutoff = new Date(Date.now() + 9 * 60 * 60 * 1000 - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    let removed = 0;
    const { data: files, error: listError } = await supabase.storage.from("backups").list("", { limit: 1000 });
    if (listError) {
      console.error(`[backup] 古いバックアップの一覧に失敗: ${listError.message}`);
    } else {
      const old = (files ?? [])
        .map((f) => f.name)
        .filter((n) => { const m = n.match(/^backup_all_(\d{4}-\d{2}-\d{2})\.csv$/); return !!m && m[1] < cutoff; });
      if (old.length > 0) {
        const { error: rmError } = await supabase.storage.from("backups").remove(old);
        if (rmError) console.error(`[backup] 古いバックアップの削除に失敗: ${rmError.message}`);
        else removed = old.length;
      }
    }

    return NextResponse.json({
      success: true,
      file: fileName,
      count: (events ?? []).length,
      removed,
      via: auth.via,
    });
  } catch (err) {
    return fail("バックアップ", err instanceof Error ? err.message : String(err));
  }
}

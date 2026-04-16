import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

export async function GET() {
  try {
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
      "\uFEFF" +
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

    return NextResponse.json({ success: true, file: fileName, count: (events ?? []).length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

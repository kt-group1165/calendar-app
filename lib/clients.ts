import { supabase } from "./supabase";

export type Client = {
  id: string;
  user_number: string;
  name: string;
  furigana: string | null;
  address: string | null;
  postal_code: string | null;
  phone: string | null;
  mobile: string | null;
  memo: string | null;
  benefit_rate: string | null;
  care_level: string | null;
  care_manager_org: string | null;
  care_manager: string | null;
  certification_end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientInsert = Omit<Client, "id" | "created_at" | "updated_at">;

export async function getClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("furigana", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function replaceAllClients(clients: ClientInsert[]): Promise<void> {
  // 全件削除
  await supabase.from("clients").delete().not("user_number", "is", null);
  // バッチ挿入（500件ずつ）
  const BATCH = 500;
  for (let i = 0; i < clients.length; i += BATCH) {
    const { error } = await supabase.from("clients").insert(clients.slice(i, i + BATCH));
    if (error) throw error;
  }
}

// CSV（Shift-JIS）をパースして ClientInsert[] に変換
export async function parseClientCSV(file: File): Promise<ClientInsert[]> {
  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder("shift-jis");
  const text = decoder.decode(buffer);

  function parseRow(line: string): string[] {
    const result: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(field); field = "";
      } else {
        field += ch;
      }
    }
    result.push(field);
    return result;
  }

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseRow(lines[0]);

  // 利用者番号でグループ化し、認定有効期間－終了日 が最新の行を採用
  const userMap = new Map<string, Record<string, string>>();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseRow(lines[i]);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { rec[h] = vals[idx]?.trim() ?? ""; });

    const num = rec["利用者番号"];
    if (!num) continue;

    const existing = userMap.get(num);
    const newEnd = rec["認定有効期間－終了日"] ?? "";
    const oldEnd = existing?.["認定有効期間－終了日"] ?? "";

    if (!existing || newEnd > oldEnd) {
      userMap.set(num, rec);
    }
  }

  const n = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);

  return Array.from(userMap.values())
    .filter((r) => r["利用者番号"] && r["利用者名"])
    .map((r) => ({
      user_number: r["利用者番号"],
      name: r["利用者名"] || `${r["利用者名（姓）"] ?? ""} ${r["利用者名（名）"] ?? ""}`.trim(),
      furigana: n(r["フリガナ"]),
      address: n(r["住所"]),
      postal_code: n(r["郵便番号"]),
      phone: n(r["電話番号"]),
      mobile: n(r["携帯番号"]),
      memo: n(r["メモ"]),
      benefit_rate: n(r["給付率"]),
      care_level: n(r["要介護度"]),
      care_manager_org: n(r["支援事業所（正式名称）"]),
      care_manager: n(r["担当ケアマネジャー"]),
      certification_end_date: n(r["認定有効期間－終了日"]),
    }));
}

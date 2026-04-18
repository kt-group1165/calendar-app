import { supabase } from "./supabase";
import type { Member } from "./members";
import type { EventArea } from "./event_areas";

// 全角・半角カッコに対応して「基本名」と「エリア名」を抽出
//   例: "山田（市原）" → { base: "山田", area: "市原" }
//   例: "山田(市原)"   → { base: "山田", area: "市原" }
//   マッチしなければ null
export function parseAreaSuffix(name: string): { base: string; area: string } | null {
  const m = name.match(/^(.+?)\s*[(（]\s*(.+?)\s*[)）]\s*$/);
  if (!m) return null;
  return { base: m[1].trim(), area: m[2].trim() };
}

// 重複候補を検出（カッコ付きの命名パターン × エリアマスタに存在する名前）
export type DuplicateGroup = {
  baseName: string;
  // このグループの全メンバー（基本名 + エリア付き変種）
  variants: Array<{
    member: Member;
    areaName: string | null; // null = 基本名のメンバー（エリアなし）
  }>;
};

export function detectDuplicates(
  members: Member[],
  areas: EventArea[],
): DuplicateGroup[] {
  const areaNames = new Set(areas.map((a) => a.name));
  // 基本名ごとにグルーピング
  const byBase = new Map<string, DuplicateGroup["variants"]>();

  for (const m of members) {
    const parsed = parseAreaSuffix(m.name);
    if (parsed && areaNames.has(parsed.area)) {
      // エリア付き変種として登録
      const key = parsed.base;
      if (!byBase.has(key)) byBase.set(key, []);
      byBase.get(key)!.push({ member: m, areaName: parsed.area });
    } else {
      // 基本名そのものの候補（後でグループに追加される可能性）
      const key = m.name;
      if (!byBase.has(key)) byBase.set(key, []);
      byBase.get(key)!.push({ member: m, areaName: null });
    }
  }

  // 「エリア付き変種が1件以上あるグループ」のみを返す
  const groups: DuplicateGroup[] = [];
  for (const [baseName, variants] of byBase.entries()) {
    const hasAreaVariant = variants.some((v) => v.areaName !== null);
    if (hasAreaVariant) {
      groups.push({ baseName, variants });
    }
  }
  // 基本名順にソート
  groups.sort((a, b) => a.baseName.localeCompare(b.baseName, "ja"));
  return groups;
}

// 統合実行: 指定されたグループの重複を基本名に統合し、各予定にエリアを設定
//   戻り値: { updatedEvents, deletedMembers }
export async function executeMerge(
  tenantId: string,
  groups: DuplicateGroup[],
  areas: EventArea[],
  allMembers: Member[],
): Promise<{ updatedEvents: number; deletedMembers: number; createdBaseMembers: number }> {
  let updatedEvents = 0;
  let deletedMembers = 0;
  let createdBaseMembers = 0;

  // エリア名 × office_id → area_id のマップ
  const areaByNameOffice = new Map<string, string>(); // key: "officeId|name"
  for (const a of areas) {
    if (a.office_id) {
      areaByNameOffice.set(`${a.office_id}|${a.name}`, a.id);
    }
  }

  // メンバー名 → Member のマップ
  const memberByName = new Map<string, Member>();
  for (const m of allMembers) memberByName.set(m.name, m);

  for (const group of groups) {
    const { baseName, variants } = group;

    // 基本名のメンバーを確保（なければ作成）
    let baseMember = variants.find((v) => v.areaName === null)?.member
      ?? memberByName.get(baseName)
      ?? null;
    if (!baseMember) {
      // 任意のエリア付き変種の色を引き継ぐ
      const firstVariant = variants[0];
      const { data: inserted, error } = await supabase
        .from("members")
        .insert({
          tenant_id: tenantId,
          name: baseName,
          color: firstVariant.member.color,
          office_id: firstVariant.member.office_id,
          sort_order: firstVariant.member.sort_order,
        })
        .select()
        .single();
      if (error) throw error;
      baseMember = inserted as Member;
      createdBaseMembers++;
    }

    // エリア付き変種ごとの処理
    for (const variant of variants) {
      if (variant.areaName === null) continue; // 基本名はスキップ
      const variantName = variant.member.name;

      // 該当する予定を取得
      const { data: events, error: eventsErr } = await supabase
        .from("events")
        .select("id, assignees, area_id, office_id")
        .eq("tenant_id", tenantId)
        .contains("assignees", [variantName]);
      if (eventsErr) throw eventsErr;

      for (const ev of (events ?? []) as Array<{
        id: string;
        assignees: string[];
        area_id: string | null;
        office_id: string | null;
      }>) {
        // assignees を書き換え: variantName → baseName
        const newAssignees = Array.from(
          new Set(
            ev.assignees.map((a) => (a === variantName ? baseName : a)),
          ),
        );

        // area_id を設定（未設定の場合のみ上書き）
        let newAreaId = ev.area_id;
        if (!newAreaId && ev.office_id) {
          const key = `${ev.office_id}|${variant.areaName}`;
          const matchedId = areaByNameOffice.get(key);
          if (matchedId) newAreaId = matchedId;
        }

        const { error: updErr } = await supabase
          .from("events")
          .update({ assignees: newAssignees, area_id: newAreaId })
          .eq("id", ev.id);
        if (updErr) throw updErr;
        updatedEvents++;
      }

      // 変種メンバーを削除
      const { error: delErr } = await supabase
        .from("members")
        .delete()
        .eq("id", variant.member.id);
      if (delErr) throw delErr;
      deletedMembers++;
    }
  }

  return { updatedEvents, deletedMembers, createdBaseMembers };
}

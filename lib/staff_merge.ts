import { supabase } from "./supabase";
import type { Member } from "./members";
import type { EventArea } from "./event_areas";
import { mapWithConcurrency } from "./concurrency";

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

// カッコ内文字列から登録エリア名を検出（前方一致・部分一致）
//   例: "市原方面用" → "市原" （"市原方面用" がカッコ内で、"市原" が登録エリアなら一致）
function findAreaNameMatch(text: string, areaNames: string[]): string | null {
  // 長い名前から優先して一致（"市原中央" と "市原" があれば "市原中央" を優先）
  const sorted = [...areaNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (text.includes(name)) return name;
  }
  return null;
}

export function detectDuplicates(
  members: Member[],
  areas: EventArea[],
): DuplicateGroup[] {
  const areaNames = Array.from(new Set(areas.map((a) => a.name)));
  // 基本名ごとにグルーピング
  const byBase = new Map<string, DuplicateGroup["variants"]>();

  for (const m of members) {
    const parsed = parseAreaSuffix(m.name);
    let matchedAreaName: string | null = null;
    if (parsed) {
      // カッコ内の文字列から登録エリア名を検出
      matchedAreaName = findAreaNameMatch(parsed.area, areaNames);
    }
    if (parsed && matchedAreaName) {
      // エリア付き変種として登録
      const key = parsed.base;
      if (!byBase.has(key)) byBase.set(key, []);
      byBase.get(key)!.push({ member: m, areaName: matchedAreaName });
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
      const inheritedOfficeId = firstVariant.member.primary_office_id;
      const { data: inserted, error } = await supabase
        .from("members")
        .insert({
          tenant_id: tenantId,
          name: baseName,
          color: firstVariant.member.color,
          sort_order: firstVariant.member.sort_order,
        })
        .select()
        .single();
      if (error) throw error;
      if (inheritedOfficeId && inserted?.id) {
        const { error: moError } = await supabase
          .from("member_offices")
          .insert({ member_id: inserted.id, office_id: inheritedOfficeId, is_primary: true });
        // member_offices が無いとその office のカレンダーから見えなくなる (CLAUDE.md
        // 「自事業所」フィルタは junction 経由) ため、握りつぶさずに投げる。
        if (moError) throw new Error(`統合先メンバーの事業所割当に失敗しました (member id: ${inserted.id}): ${moError.message}`);
      }
      baseMember = {
        ...(inserted as Omit<Member, "office_ids" | "primary_office_id">),
        office_ids: inheritedOfficeId ? [inheritedOfficeId] : [],
        primary_office_id: inheritedOfficeId ?? null,
      };
      createdBaseMembers++;
    }

    // エリア付き変種ごとの処理
    for (const variant of variants) {
      if (variant.areaName === null) continue; // 基本名はスキップ
      const variantName = variant.member.name;

      // 該当する予定を取得
      //
      // ⚠ **必ずページングすること。** PostgREST は 1 回 1000 行しか返さない。
      //   ここで打ち切ると 1000 件だけ担当者名を書き換えたあとに下で変種 member を
      //   DELETE するので、残った予定が「存在しない担当者」を指したまま取り残される
      //   (2026-08-31 是正。event_types.ts のマージも同じ穴だった)。
      //
      // ⚠ 2026-09-02 是正: events.tenant_id 列は Phase 3c-5 で DROP 済み
      //   (scope_office_ids[] ベースの設計に移行)。tenant scoping は
      //   lib/events.ts の getAllEvents() と同じく RLS (scope_office_ids) に
      //   委譲されている ("Phase 5b" コメント参照) ため、.eq("tenant_id", ...)
      //   は付けない (付けると存在しない列を参照して 42703 で確実に落ちる、
      //   実際にそうなっていた)。AdminPanel はスタッフ統合を特定 office に
      //   絞らず全社横断で行う機能のため、office_id によるフィルタも付けない。
      const PAGE = 1000;
      const events: Array<{ id: string; assignees: string[]; area_id: string | null; office_id: string | null }> = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: eventsErr } = await supabase
          .from("events")
          .select("id, assignees, area_id, office_id")
          .contains("assignees", [variantName])
          .order("id")
          .range(from, from + PAGE - 1);
        if (eventsErr) throw eventsErr;
        events.push(...((data ?? []) as typeof events));
        if (!data || data.length < PAGE) break;
      }

      // event は互いに独立な UPDATE なので上限付き並列 (concurrency=6)。
      // ⚠ worker 内で throw すると Promise.all が即 reject し、まだ実行中の他の
      //   runner は「投げっぱなし」でバックグラウンドに残ってしまう (呼出元が
      //   catch した後もいつ完了するか分からない状態になる。実測で確認した罠)。
      //   それを避けるため、エラーは worker 内で捕まえて配列に集約し、
      //   **全 item の実行が終わってから**まとめて throw する (直列版の
      //   「1件失敗したら以降は未着手のまま」より一歩前進: 到達可能な範囲は
      //   全部試みたうえでエラーを報告する。書き換えは冪等なので再実行で
      //   残りを拾い直せる点は直列版と同じ)。
      const mergeErrors: unknown[] = [];
      await mapWithConcurrency(
        events,
        async (ev) => {
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
          if (updErr) { mergeErrors.push(updErr); return; }
          updatedEvents++;
        },
        6,
      );
      if (mergeErrors.length > 0) throw mergeErrors[0];

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

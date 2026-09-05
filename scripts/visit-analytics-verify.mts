/**
 * 福祉用具管理者 訪問分析 (/{tenant}/visit-analytics) の集計定義を固定する検証
 * (READ ONLY / DB書込なし)
 *
 *   npx tsx scripts/visit-analytics-verify.mts
 *
 * 対象は `lib/visit_analytics.ts` の実関数をそのまま呼ぶ (JS移植・逐語コピーはしない)。
 *
 * ① judgeStatus (達成状況の色判定) — 純関数。境界値 + 負のコントロール
 * ② 集計の「母数」を実データで固定する:
 *    - events のうち何が「訪問」として数えられるか (event_type / is_demo / area_id の絞り込み)
 *    - resolveTargetOffices (非export) の分岐: 1件確定 / 複数office一致 /
 *      assignee空→全候補に配分 / primary不一致→全候補に配分
 *      ★ 後2つは「1つのeventが複数セルにカウントされる」= 母数(events) と
 *        実書込セル数が食い違う設計。バグではなく「対応事業所が分からない
 *        assigneeの予定を消さない」という意図的なフォールバックだが、
 *        「訪問件数」の実態が額面より多く見えることは記録しておく。
 *    - 2026-08 (フォールバック発火ゼロの月) を基準に、getVisitStats() の
 *      出力を実 events から手計算した値と突き合わせる (同じ関数を検証する
 *      ための独立した再計算)
 *
 * ⚠ このモジュールは「今の定義」を固定するもので、どちらの定義が
 *   正しいかは判断しない (運用判断)。
 */
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(__dirname, "../.env.local");
  const txt = fs.readFileSync(envPath, "utf8");
  for (const l of txt.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  // ⚠ lib/visit_analytics.ts は lib/supabase.ts → getSupabase() (anon key の
  //   ブラウザ client) を module-level で使う。画面上は認証済セッションで
  //   RLS を通るが、この script には session cookie が無いので anon のままだと
  //   fukuyogu_area_targets / events が RLS で 0 件になり「集計が壊れている」
  //   ように誤診する。**読み取り専用の検証**なので、この script の中でだけ
  //   NEXT_PUBLIC_SUPABASE_ANON_KEY を service_role に差し替えて RLS を
  //   バイパスする (アプリのコード・env・DBは一切変更しない)。
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
}

const {
  getVisitTargets,
  getVisitStats,
  getMonthlyTrend,
  judgeStatus,
  FUKUYOGU_KANRI_OFFICE_ID,
  FUKUYOGU_OFFICE_IDS,
} = await import("../lib/visit_analytics");
const { createClient } = await import("@supabase/supabase-js");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let n = 0, ng = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  n++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) ng++;
  console.log(`  ${ok ? "OK " : "NG "} ${label.padEnd(56)} ${ok ? "" : `実際=${JSON.stringify(actual)} 期待=${JSON.stringify(expected)}`}`);
}

async function pageAll<T>(table: string, select: string, orderCol = "id"): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(select).order(orderCol).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  console.log("══ ① judgeStatus (達成状況の色判定) — 境界値 ══");
  eq("経過0日 / 目標7日 → good", judgeStatus(0, 7), "good");
  eq("★ 経過6日 / 目標7日 (target未満) → good", judgeStatus(6, 7), "good");
  eq("★ 経過7日 / 目標7日 (ちょうど target) → warn (< ではなく <= で切り替わる)", judgeStatus(7, 7), "warn");
  eq("経過10日 / 目標7日 (target×1.5=10.5未満) → warn", judgeStatus(10, 7), "warn");
  eq("★ 経過10.5日相当 (target×1.5ちょうど) → danger (< なので境界はdanger側)", judgeStatus(10.5, 7), "danger");
  eq("経過11日 / 目標7日 (target×1.5超) → danger", judgeStatus(11, 7), "danger");
  eq("経過null (未訪問) → none", judgeStatus(null, 7), "none");
  eq("経過0日 / 目標1日 (毎日目標・当日訪問) → good", judgeStatus(0, 1), "good");
  eq("経過1日 / 目標1日 (毎日目標・1日空いた) → warn", judgeStatus(1, 1), "warn");

  // ★ /admin/visit-targets (目標頻度の編集画面) の追加検証。
  //   handleAdd() は newDays<=0 を弾くが、★ handleSave() (既存行の編集) には
  //   同じ検証が無い (2026-09-05 実測: app/admin/visit-targets/page.tsx:69-80)。
  //   実データでは 0 以下の行は現状 0 件 (2026-09-05実測・全26行) だが、
  //   編集画面から 0 を入れて保存できてしまう状態。到達したときの実際の挙動を
  //   固定しておく。
  console.log("\n  ⚠ /admin/visit-targets の編集(handleSave)には newDays<=0 のガードが無い");
  console.log("     (追加(handleAdd)にはある。2026-09-05実測: 実データに該当行は0件)");
  eq("★ target=0 で今日訪問 (daysAgo=0) → danger (0<0はfalseなので即危険表示になる)",
    judgeStatus(0, 0), "danger");
  const monthlyTargetAtZero = 30 / 0;
  eq("★ trend画面の月間目標 30/target_frequency_days は target=0 で Infinity になる",
    monthlyTargetAtZero, Infinity);
  eq("★ Infinityで割るので、visitsが1件以上あっても ratio=0 (未達表示になる)",
    3 / monthlyTargetAtZero, 0);

  // ★ 負のコントロール: 比較演算子を壊して境界が動くことを確認する
  {
    const brokenJudge = (daysAgo: number | null, targetDays: number): string => {
      if (daysAgo === null) return "none";
      if (daysAgo <= targetDays) return "good"; // ★ < を <= に破壊 (本来は 7 で warn になるはず)
      if (daysAgo < targetDays * 1.5) return "warn";
      return "danger";
    };
    const before = ng;
    n++;
    if (brokenJudge(7, 7) !== judgeStatus(7, 7)) {
      console.log("  ✓ 負のコントロール OK (境界を <= に壊すと経過7日/目標7日の判定が変わり、本物の判定と食い違う)");
    } else {
      ng++;
      console.log("  ✗✗✗ 負のコントロール失敗 — 演算子を壊しても判定が変わらない");
    }
    void before;
  }

  console.log("\n══ ② 集計の母数を実データで固定する ══");
  const targets = await getVisitTargets();
  console.log(`【分母】fukuyogu_area_targets: ${targets.length} 行 (エリア×事業所の目標定義)`);
  const areaIds = new Set(targets.map((t) => t.area_id));
  const areaToOffices = new Map<string, string[]>();
  for (const t of targets) {
    if (!areaToOffices.has(t.area_id)) areaToOffices.set(t.area_id, []);
    areaToOffices.get(t.area_id)!.push(t.office_id);
  }
  const multiOfficeAreas = [...areaToOffices.values()].filter((o) => o.length > 1).length;
  console.log(`  distinct エリア: ${areaIds.size} / distinct 事業所: ${new Set(targets.map((t) => t.office_id)).size}`);
  console.log(`  1エリアに複数事業所候補があるエリア: ${multiOfficeAreas} / ${areaToOffices.size} (= フォールバック発火時に水増しが起きうる範囲)`);

  type EventRowFull = {
    id: string; area_id: string | null; event_type: string[] | null; assignees: string[] | null;
    is_demo: boolean; deleted_at: string | null; office_id: string | null; start_date: string;
  };
  const events = await pageAll<EventRowFull>("events", "id, area_id, event_type, assignees, is_demo, deleted_at, office_id, start_date");
  const live = events.filter((e) => e.office_id === FUKUYOGU_KANRI_OFFICE_ID && !e.deleted_at && e.area_id && !e.is_demo);
  const visitTyped = live.filter((e) => (e.event_type ?? []).some((t) => t.includes("個別訪問") || t.includes("ミーティング時訪問") || t.includes("その他")));
  console.log(`\n【分母】office_id=福祉用具管理者・is_demo=false・area_id有・deleted_at無: ${live.length} 件`);
  console.log(`  うち 訪問系event_type (個別訪問/ミーティング時訪問/その他) を含む = 集計対象の母数: ${visitTyped.length} 件`);

  const unknownArea = visitTyped.filter((e) => !areaIds.has(e.area_id!));
  eq("★ area_targetsに無いarea_idのeventは0件のはず (未知エリアは黙って除外される設計)", unknownArea.length, 0);

  const members = await pageAll<{ id: string; name: string }>("members", "id, name");
  // ★ getAssigneePrimaryOfficeMap() は members.name をキーに member_id を引く
  //   (memory: feedback_name_based_lookup_collision_risk — 同姓同名だと後勝ちで
  //   別人のprimary officeを誤って掴む)。visit_analytics.ts は未修正のままなので、
  //   まず「母数」= 実際に同姓同名が何組あるかを固定する (2026-09-05実測)。
  const byNameAll = new Map<string, string[]>();
  for (const m of members) { if (!byNameAll.has(m.name)) byNameAll.set(m.name, []); byNameAll.get(m.name)!.push(m.id); }
  const nameCollisions = [...byNameAll.entries()].filter(([, ids]) => ids.length > 1);
  console.log(`\n★ 【分母】members 全${members.length}件中、同姓同名(name完全一致で2件以上): ${nameCollisions.length} 組`);
  if (nameCollisions.length === 0) {
    console.log("  → 0組。name-based lookupの誤爆リスクは現状未発火 (id引きへの是正は不要な状態)。");
  } else {
    for (const [nm, ids] of nameCollisions) console.log(`  ★ ${nm}  x${ids.length}  ids=${ids.join(",")}`);
    console.log("  ⚠ 1組以上あるので、visit_analytics.ts の getAssigneePrimaryOfficeMap() は");
    console.log("    name一致で後勝ちする設計のため、この名前がfukuyogu-kanriのeventのassigneeに");
    console.log("    使われていると誤ったprimary officeに集計される可能性がある。id引きへの是正を検討すること。");
  }
  // ⚠ ここは pass/fail の assertion にしない (0を目指す検査にしない・規律)。
  //   同姓同名の出現はコードのバグではなくデータの事実であり、増えても
  //   「壊れた」わけではない。出現したら人が見て是正を判断する。

  const nameToId = new Map(members.map((m) => [m.name, m.id]));
  const mo = await pageAll<{ member_id: string; office_id: string; is_primary: boolean }>(
    "member_offices",
    "member_id, office_id, is_primary",
    "member_id",
  );
  const relevantMo = mo.filter((r) => (FUKUYOGU_OFFICE_IDS as readonly string[]).includes(r.office_id));
  const memberPrimary = new Map<string, string>();
  for (const r of relevantMo) if (r.is_primary) memberPrimary.set(r.member_id, r.office_id);
  for (const r of relevantMo) if (!memberPrimary.has(r.member_id)) memberPrimary.set(r.member_id, r.office_id);
  const nameToPrimary = new Map<string, string>();
  for (const [name, id] of nameToId) {
    const o = memberPrimary.get(id);
    if (o) nameToPrimary.set(name, o);
  }

  let matched1 = 0, matchedMulti = 0, noAssignee = 0, noMatch = 0, cellsWritten = 0;
  for (const e of visitTyped) {
    const candidates = areaToOffices.get(e.area_id!) ?? [];
    const names = e.assignees ?? [];
    if (names.length === 0) { noAssignee++; cellsWritten += candidates.length; continue; }
    const matchedOffices = [...new Set(names.map((nm) => nameToPrimary.get(nm)).filter((o): o is string => !!o && candidates.includes(o)))];
    if (matchedOffices.length === 0) { noMatch++; cellsWritten += candidates.length; }
    else if (matchedOffices.length === 1) { matched1++; cellsWritten += 1; }
    else { matchedMulti++; cellsWritten += matchedOffices.length; }
  }
  console.log(`\n★ 「1 event = 複数セルにカウントされうる」フォールバックの内訳 (全期間・母数 ${visitTyped.length} 件):`);
  console.log(`  1件に確定 (assignee一致): ${matched1}`);
  console.log(`  複数事業所にmatch (兼務等): ${matchedMulti}`);
  console.log(`  assignee空 → 候補全部に配分: ${noAssignee}`);
  console.log(`  assignee居るがprimary不一致 → 候補全部に配分: ${noMatch}`);
  console.log(`  → 実際に書き込まれるセル数(延べ) = ${cellsWritten} (母数比 +${cellsWritten - visitTyped.length} 件、${(((cellsWritten - visitTyped.length) / visitTyped.length) * 100).toFixed(1)}% の水増し)`);
  console.log(`  ⚠ これはバグではなく「対応事業所が分からないassigneeの予定を消さない」ための設計。`);
  console.log(`     「訪問件数」の見た目は母数(実event数)より${cellsWritten > visitTyped.length ? "多く" : "同じに"}なりうる、という定義を記録する。`);

  console.log("\n══ getVisitStats() を実データと突き合わせる (2026-08。フォールバック発火0件の月) ══");
  const stats = await getVisitStats(2026, 8, false);
  const sumFromStats = [...stats.values()].reduce((s, v) => s + v.total_count, 0);
  const augEvents = visitTyped.filter((e) => e.start_date >= "2026-08-01" && e.start_date <= "2026-08-31");
  eq("getVisitStats(2026,8) の合計セル数 = 手計算した2026-08の訪問event数 (この月はフォールバック無しなので1:1のはず)",
    sumFromStats, augEvents.length);

  const trend = await getMonthlyTrend(6, false);
  const trendAugSum = [...trend.values()].flat().filter((t) => t.yyyymm === "2026-08").reduce((s, t) => s + t.individual_count + t.meeting_count + t.other_count, 0);
  eq("getMonthlyTrend() の2026-08合計 = getVisitStats(2026,8) の合計 (同じ月を2つの関数で見て一致するはず)",
    trendAugSum, sumFromStats);

  console.log(`\n══ 検査 ${n} 件 / NG ${ng} 件 ══`);
  if (ng > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("✗ 検証中にエラー:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

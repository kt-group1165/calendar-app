/**
 * events.scope_office_ids[] の自動展開ロジック検証 (READ ONLY / DB書換なし)
 *
 *   npx tsx scripts/events-scope-verify.mts
 *
 * 対象は DB 関数 `events_compute_auto_scope(office_id, assignees)`
 * (migrations/applied_archive/phase_9_5*.sql、現行は 9-5e 版)。
 * plpgsql 関数なので JS に移植せず、**実際にデプロイされている関数を
 * PostgREST RPC 経由でそのまま呼ぶ**(画面と同じ関数をそのまま呼ぶ原則)。
 *
 * 検証する不変条件:
 *   ① 兼務 staff (通常 office 同士) → 両方の office が scope に入る
 *   ② 単一 office staff → 自分の office だけ
 *   ③ origin が auto_scope_no_expand → scope = [origin] のみ (assignee 展開しない)
 *   ④ assignee の所属 office が auto_scope_no_expand → その office は scope に
 *      入らない (origin 自体は no_expand でなくても除外される)
 *   ⑤ ③④は独立 (origin 側の遮断と展開先側の遮断の両方が効く)
 *   ⑥ SECURITY DEFINER が効いている → anon key (RLS 制限あり) で呼んでも
 *      service_role と同じ結果になる (2026-06-02 の実バグの再発検知)
 *
 * ★ 「見えるべきものが見える」と「見えるべきでないものが見えない」の両方を見る
 *   (配列の**完全一致**で assert する。「含む」だけだと過剰漏出を見逃す)
 *
 * ★ 負のコントロール: no_expand フィルタを掛けない「素朴な union」を自前で
 *   計算し、実際の RPC 結果と**意図的に食い違う**ことを示す。
 *   一致してしまったら「このテストは何も検証していない」ことになる。
 *
 * 実データを読むだけ。events テーブルへの書込は一切しない。
 */

const env: Record<string, string> = {};
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(__dirname, "../../kaigo-app/.env.local"), path.join(__dirname, "../.env.local")]) {
    let txt = "";
    try { txt = fs.readFileSync(p, "utf8"); } catch { continue; }
    for (const l of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !SVC || !ANON) {
  console.log("⚠ 環境変数が無いのでスキップします。");
  process.exit(0);
}

async function rpcScope(officeId: string | null, assignees: string[], key: string): Promise<string[]> {
  const r = await fetch(`${URL_}/rest/v1/rpc/events_compute_auto_scope`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_office_id: officeId, p_assignees: assignees }),
  });
  if (!r.ok) throw new Error(`RPC failed (${r.status}): ${await r.text()}`);
  return (await r.json()) as string[];
}

async function svcSelect<T>(path: string): Promise<T[]> {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
  if (!r.ok) throw new Error(`select failed (${r.status}): ${await r.text()}`);
  return (await r.json()) as T[];
}

let n = 0, ng = 0;
function eqSet(label: string, actual: string[], expected: string[]) {
  n++;
  const a = [...actual].sort().join(",");
  const b = [...expected].sort().join(",");
  const ok = a === b;
  if (!ok) ng++;
  console.log(`  ${ok ? "OK " : "NG "} ${label.padEnd(56)} ${ok ? "" : `実際=[${a}] 期待=[${b}]`}`);
}

async function main() {
  // ── 実データから今日時点の状況を確認 ──
  const noExpandOffices = await svcSelect<{ id: string; name: string }>(
    "offices?select=id,name&auto_scope_no_expand=eq.true",
  );
  console.log(`【分母】auto_scope_no_expand=true な office: ${noExpandOffices.length} 件`);
  for (const o of noExpandOffices) console.log(`  ${o.id}  ${o.name}`);
  if (noExpandOffices.length === 0) {
    console.log("⚠ no_expand office が無いので③④のテストをスキップします。");
  }
  const NO_EXPAND = noExpandOffices[0]?.id;

  // 実在する検証用の人物・office (2026-09-05 実測で確認済み)
  const YARITA = "鎗田 秀記"; // no_expand + 通常office(ケアサポ千葉) の兼務。9-5e 修正の実例そのもの
  const YARITA_NORMAL_OFFICE = "1bfc0d57-9ee0-4ae2-baa5-80edb776290a"; // 介護ショップケア・サポート千葉
  const SINGLE_STAFF = "三橋 ゆりこ";
  const SINGLE_STAFF_OFFICE = "26010be4-8223-49b9-9db2-9c6d20bd1c05"; // Ｈａｎａ船橋ヘルパーステーション
  const MULTI_STAFF = "馬渡 春奈";
  const MULTI_STAFF_OFFICES = ["c0bf0c6a-c3a7-4e66-8dfd-6c6085050066", "24596958-b434-466e-800b-842f66f84a8e"];
  const THIRD_OFFICE = "5e8a6e8d-bbcd-460f-91da-d846f6d44db7"; // 統括営業本部 (誰も兼務していない第三者 office)

  console.log("\n══ ① 兼務 (通常 office 同士) ══");
  eqSet("origin=自分の所属office → 両方入る",
    await rpcScope(MULTI_STAFF_OFFICES[0], [MULTI_STAFF], SVC), MULTI_STAFF_OFFICES);
  eqSet("origin=第三者office → origin+両方の計3つ",
    await rpcScope(THIRD_OFFICE, [MULTI_STAFF], SVC), [THIRD_OFFICE, ...MULTI_STAFF_OFFICES]);

  console.log("\n══ ② 単一 office staff ══");
  eqSet("origin=自分のoffice → 自分のoffice1つだけ",
    await rpcScope(SINGLE_STAFF_OFFICE, [SINGLE_STAFF], SVC), [SINGLE_STAFF_OFFICE]);
  eqSet("origin=第三者office → origin+自分のoffice",
    await rpcScope(THIRD_OFFICE, [SINGLE_STAFF], SVC), [THIRD_OFFICE, SINGLE_STAFF_OFFICE]);
  eqSet("assignee無し → originのみ",
    await rpcScope(THIRD_OFFICE, [], SVC), [THIRD_OFFICE]);
  eqSet("存在しないassignee名 → クラッシュせずoriginのみ",
    await rpcScope(THIRD_OFFICE, ["存在しない 太郎"], SVC), [THIRD_OFFICE]);
  eqSet("office_id=null + assignee無し → 空配列",
    await rpcScope(null, [], SVC), []);
  eqSet("office_id=null + 単一staff → staffのofficeのみ",
    await rpcScope(null, [SINGLE_STAFF], SVC), [SINGLE_STAFF_OFFICE]);

  if (NO_EXPAND) {
    console.log("\n══ ③ origin が no_expand → 展開しない (出方向遮断) ══");
    eqSet("origin=no_expand, assignee=鎗田(no_expand+通常) → no_expandのみ",
      await rpcScope(NO_EXPAND, [YARITA], SVC), [NO_EXPAND]);
    eqSet("origin=no_expand, assignee=無関係の単一staff → no_expandのみ (staffのofficeは入らない)",
      await rpcScope(NO_EXPAND, [SINGLE_STAFF], SVC), [NO_EXPAND]);
    eqSet("origin=no_expand, assignee無し → no_expandのみ",
      await rpcScope(NO_EXPAND, [], SVC), [NO_EXPAND]);

    console.log("\n══ ④ 展開先が no_expand → その office だけ除外 (入方向遮断) ══");
    console.log("  ※ 2026-06-02 の実バグ (鎗田がケアサポ千葉で予定作成→福祉用具管理者に漏出) の再現テスト");
    eqSet("origin=鎗田の通常office, assignee=鎗田 → 通常officeのみ (no_expandは入らない)",
      await rpcScope(YARITA_NORMAL_OFFICE, [YARITA], SVC), [YARITA_NORMAL_OFFICE]);
    eqSet("origin=第三者office, assignee=鎗田 → origin+鎗田の通常office (no_expandは入らない)",
      await rpcScope(THIRD_OFFICE, [YARITA], SVC), [THIRD_OFFICE, YARITA_NORMAL_OFFICE]);

    console.log("\n══ ⑤ 複数assignee混在 (通常+no_expand兼務 と 通常のみ) ══");
    eqSet("origin=第三者, assignee=[鎗田, 単一staff] → 第三者+鎗田の通常+単一staffのoffice (no_expand除外)",
      await rpcScope(THIRD_OFFICE, [YARITA, SINGLE_STAFF], SVC),
      [THIRD_OFFICE, YARITA_NORMAL_OFFICE, SINGLE_STAFF_OFFICE]);

    console.log("\n══ ⑥ SECURITY DEFINER: anon key でも service_role と同じ結果になるか ══");
    console.log("  (2026-06-02 の実バグ: caller の RLS で member_offices が制限され、統括営業本部が漏れていた)");
    const svcResult = await rpcScope(THIRD_OFFICE, [YARITA], SVC);
    const anonResult = await rpcScope(THIRD_OFFICE, [YARITA], ANON);
    eqSet("anon key の結果 = service_role の結果", anonResult, svcResult);

    // ★ 負のコントロール: no_expand フィルタを掛けない「素朴な union」を自前で計算し、
    //   実際の RPC 結果と食い違うことを示す (フィルタが本当に何かを除外していることの証明)。
    console.log("\n══ 負のコントロール: no_expand フィルタが無かったらどうなっていたか ══");
    const memberRows = await svcSelect<{ id: string; name: string }>(`members?select=id,name&name=eq.${encodeURIComponent(YARITA)}`);
    const memberId = memberRows[0]?.id;
    const rawOffices = memberId
      ? (await svcSelect<{ office_id: string }>(`member_offices?select=office_id&member_id=eq.${memberId}`)).map((r) => r.office_id)
      : [];
    const naiveUnion = [...new Set([THIRD_OFFICE, ...rawOffices])];
    const actualResult = await rpcScope(THIRD_OFFICE, [YARITA], SVC);
    const naiveIncludesNoExpand = naiveUnion.includes(NO_EXPAND);
    const actualIncludesNoExpand = actualResult.includes(NO_EXPAND);
    n++;
    if (naiveIncludesNoExpand && !actualIncludesNoExpand) {
      console.log(`  ✓ 負のコントロール OK — フィルタ無し(素朴なunion)なら no_expand office が入っていた([${naiveUnion.sort().join(",")}])が、`);
      console.log(`    実際の RPC はそれを除外している([${actualResult.sort().join(",")}])。フィルタは本当に何かを除外している。`);
    } else {
      ng++;
      console.log(`  ✗✗✗ 負のコントロール失敗 — 素朴な union と実際の結果が食い違わない。このテストは no_expand 除外を検証できていない`);
      console.log(`    素朴union=[${naiveUnion.sort().join(",")}] 実際=[${actualResult.sort().join(",")}]`);
    }
  }

  console.log(`\n══ 検査 ${n} 件 / NG ${ng} 件 ══`);
  if (ng > 0) {
    console.log("★ FAIL — 上記 NG を確認すること。");
    process.exitCode = 1;
  } else {
    console.log("✓ すべて通りました。events テーブルへの書込は一切していません。");
  }
}

main();

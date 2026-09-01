/**
 * 上限付き並列実行ヘルパー。スタッフ統合・イベント種別統合などの
 * 「1件ずつ直列 await」をまとめて速くしつつ、DB への同時接続数を抑える。
 *
 * order-app の `lib/concurrency.ts` / payroll-app の `lib/concurrency.ts` /
 * kaigo-app の `lib/chunk-parallel.ts` (`mapChunksParallel`) と同じ設計思想:
 * items を worker に渡し、`concurrency` 本のランナーが早い者勝ちで次の item を取る。
 *
 * worker が throw した場合は Promise.all の通常仕様どおり即座に reject される
 * (= 呼出元の catch/throw 伝播はそのまま維持される)。ただし直列版と違い、
 * 他の並列中の item は「投げっぱなし」で完了まで走り続ける点に注意
 * (キャンセルはできない)。呼出元の操作が冪等・再実行安全な場合のみ使うこと。
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 6,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/**
 * 失敗しても処理は続けてよい書き込み (last_seen_at の更新・使い終わった challenge の掃除 など) の結果を受け取り、
 * 失敗していればログに残す。以前は戻り値を捨てていて、失敗がどこにも出なかった (2026-10-19 是正)。
 * 失敗したら止めるべき書き込みには使わない ({ error } を見て return / throw する)。
 */
export function logWriteError(label: string, res: { error: { message: string } | null }): void {
  if (res.error) console.error(`[${label}] 書き込みに失敗 (処理は続行): ${res.error.message}`);
}

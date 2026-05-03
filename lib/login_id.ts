// Phase 2-7: email を使わない認証のための synthetic email 派生。
//
// 方針:
//   - Supabase auth.users.email は globally unique 制約があるので、これを
//     "username" 列として流用する。
//   - 実メールは飛ばさない。RFC 2606 で予約されている `.invalid` TLD を
//     使うので、誤って外部に漏れても解決不能で副作用が出ない。
//   - login_id は invitee が招待 consume 時に決める。
//
// 注: この module は server / client 両方から import される。Node 専用
//     API（crypto 等）は持ち込まないこと。

const SYNTHETIC_EMAIL_DOMAIN = "kt-staff.invalid";

// login_id の正規表現:
//   - 先頭は英小文字（数字や記号で始まると見誤りやすい）
//   - 続く文字は英小文字 / 数字 / `.` / `-`
//   - 全長 4〜24 chars
//
// 数字の 0/O や 1/l/I が混じる可能性は許容（login_id は invitee 自身が
// 選ぶため、本人の覚えやすさ優先）。
export const LOGIN_ID_REGEX = /^[a-z][a-z0-9.\-]{3,23}$/;

export function isValidLoginId(loginId: string): boolean {
  return LOGIN_ID_REGEX.test(loginId);
}

// login_id → synthetic email。auth.users.email にそのまま入れる値。
// ブラウザでも Node でも同じ結果を返す純関数。
export function loginIdToSyntheticEmail(loginId: string): string {
  if (!isValidLoginId(loginId)) {
    throw new Error(`invalid login_id: ${loginId}`);
  }
  return `${loginId}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

// synthetic email から login_id を逆引き。/login で表示用に使う。
// 不正な形式（`.invalid` でない、@ が無い等）の場合は null を返す。
export function syntheticEmailToLoginId(email: string): string | null {
  const [local, domain] = email.split("@");
  if (!local || domain !== SYNTHETIC_EMAIL_DOMAIN) return null;
  if (!isValidLoginId(local)) return null;
  return local;
}

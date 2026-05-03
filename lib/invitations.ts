// Phase 2-7: スタッフ招待のサーバ側ヘルパー。
//
// scrypt によるパスワード hash、ランダムトークン / 初期パスワード生成。
// node:crypto のみ使用（zero-dep）。
//
// 注: この module は Server Component / Route Handler 専用。
//     "use client" コンポーネントから import しないこと。

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

// scrypt パラメータ。N=2^14 は OWASP 2023 推奨の最低ライン。
// 1 hash あたり ~50ms（Vercel Functions の典型 CPU で）。
//
// keylen=32（256 bits）、salt=16（128 bits）。
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_LEN = 16;

// initial password 用の文字集合。
//   - 英大小・数字から目視で紛らわしい文字 (0/O, 1/l/I) を除外
//   - 12 chars → 約 71 bits のエントロピー（7 日有効、トークンと AND で
//     ブルートフォース不可能）
const PASSWORD_ALPHABET =
  "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PASSWORD_LENGTH = 12;

// URL に乗せる招待トークン。32 bytes = 43 chars base64url。
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// 初期パスワード生成（plaintext）。
// admin に 1 回だけ表示するため、API レスポンスでそのまま返却する。
// DB には scrypt hash のみ保存。
export function generateInitialPassword(): string {
  // randomBytes で偏りなく文字集合からピック。
  // 256 % 54 ≠ 0 で完全に均等にはならないが、運用上問題ない範囲。
  const bytes = randomBytes(PASSWORD_LENGTH * 2); // 余裕を持って 2 倍引く
  let out = "";
  let i = 0;
  while (out.length < PASSWORD_LENGTH && i < bytes.length) {
    const b = bytes[i++];
    if (b < Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length) {
      out += PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length];
    }
  }
  if (out.length < PASSWORD_LENGTH) {
    // 極めて稀なケース：生のランダムから直接埋める fallback。
    while (out.length < PASSWORD_LENGTH) {
      out += PASSWORD_ALPHABET[randomBytes(1)[0] % PASSWORD_ALPHABET.length];
    }
  }
  return out;
}

// password を hash 化。staff_invitations.initial_password_hash に格納する形式。
// 形式: `<saltHex>:<hashHex>`（区切り文字 `:` は base16 に出現しないので衝突しない）
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

// stored hash と password 入力値の照合。タイミング攻撃耐性あり。
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (salt.length !== SCRYPT_SALT_LEN || expected.length !== SCRYPT_KEYLEN) {
    return false;
  }

  const actual = await scrypt(password, salt, SCRYPT_KEYLEN);
  // length が同じ場合のみ timingSafeEqual を呼べる。上で長さ検証済み。
  return timingSafeEqual(actual, expected);
}

/**
 * 認証ユーティリティ。
 *
 * - パスワード: Node 標準の scrypt でハッシュ化 (salt 16B、N=16384, r=8, p=1 デフォルト)
 * - トークン: crypto.randomBytes(32).toString("base64url")
 *   高エントロピーなので保存側は sha256 で十分 (定数時間比較できれば良い)
 */

import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;
const SALT_LEN = 16;

/** scrypt によるパスワードハッシュ。形式: `scrypt$<saltHex>$<hashHex>` */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error("password too short (min 8)");
  const salt = randomBytes(SALT_LEN);
  const derived = (await scrypt(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;
  let saltBuf: Buffer;
  let expected: Buffer;
  try {
    saltBuf = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN) return false;
  const derived = (await scrypt(password, saltBuf, KEY_LEN)) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Bearer に乗せる高エントロピートークン。URL-safe で 32 バイト分。 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** ペアリング ID。UUID v4 をそのまま使う (URL に直接埋まる)。 */
export function generatePairingId(): string {
  return randomUUID();
}

/** 保存・比較用ハッシュ。トークンは高エントロピーなので sha256 で十分。 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 入力文字列の constant-time 比較。長さが違っても safe。 */
export function constantTimeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) {
    // 長さ違いでも timingSafeEqual に揃えてダミー比較する
    const dummy = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, dummy);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

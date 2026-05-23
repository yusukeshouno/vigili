import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * PWA / WebSocket クライアント認証用 token。
 * - 起動時に `~/.sentinel/token` が無ければ 32 バイトの hex を生成する。
 * - パーミッションは 0600。
 * - 漏れたら user がファイルを消して daemon を再起動 → 再生成。
 */
export function loadOrCreateToken(path: string): string {
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8").trim();
    if (raw.length >= 32) return raw;
    // 既存だが短い (壊れている / 旧 token) なら再生成
  }
  const token = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token, { mode: 0o600 });
  return token;
}

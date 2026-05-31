/**
 * セッショントークンの発行と検証。
 *
 * 寿命は 30 日。touchSession で last_used_at を更新する (slide はしない、明示更新が必要)。
 */

import { generateToken, hashToken } from "./auth.js";
import type { RelayStore } from "./db.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedSession {
  token: string;
  expires_at: number;
}

export function issueSession(
  store: RelayStore,
  accountId: string,
  now = Date.now(),
): IssuedSession {
  const token = generateToken();
  const expires_at = now + SESSION_TTL_MS;
  store.insertSession({
    token_hash: hashToken(token),
    account_id: accountId,
    created_at: now,
    expires_at,
    last_used_at: now,
  });
  return { token, expires_at };
}

export interface AuthenticatedAccount {
  account_id: string;
  token_hash: string;
}

export function verifySessionToken(
  store: RelayStore,
  rawToken: string,
  now = Date.now(),
): AuthenticatedAccount | null {
  if (!rawToken) return null;
  const token_hash = hashToken(rawToken);
  const session = store.findSession(token_hash);
  if (!session) return null;
  if (session.expires_at < now) {
    store.deleteSession(token_hash);
    return null;
  }
  store.touchSession(token_hash, now);
  return { account_id: session.account_id, token_hash };
}

/** Authorization: Bearer <token> ヘッダ または ?token= から bearer を抜く */
export function extractBearer(authHeader: string | undefined, url: string): string | null {
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1];
  }
  const qIndex = url.indexOf("?");
  if (qIndex >= 0) {
    const params = new URLSearchParams(url.slice(qIndex + 1));
    const t = params.get("token");
    if (t) return t;
  }
  return null;
}

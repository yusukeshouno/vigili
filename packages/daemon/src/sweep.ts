import type { ApprovalRequest } from "@vigili/shared";
import type { RequestStore } from "./db/store.js";
import type { PendingQueue } from "./queue.js";

/**
 * gate (packages/gate) が ask の決着を待つデフォルトタイムアウト。
 * packages/gate/src/client.ts の `askTimeoutMs ?? 5 * 60_000` と一致させる。
 * gate CLI はこの値を上書きしないので、実運用では常に 300s。
 */
export const GATE_ASK_TIMEOUT_MS = 5 * 60_000;

/**
 * pending TTL のデフォルト (ms)。gate タイムアウトに 60s の余裕を足し、
 * 正常応答中 / 通常 enroll タイムアウト中のリクエストを誤って expired にしない。
 */
export const DEFAULT_PENDING_TTL_MS = GATE_ASK_TIMEOUT_MS + 60_000;

export interface SweepStaleInput {
  store: RequestStore;
  queue: PendingQueue;
  /** 現在時刻 (epoch ms)。テストから固定値を渡せるよう引数化。 */
  now: number;
  /** created_at がこの ms より古い pending を回収する。 */
  ttlMs: number;
}

/**
 * TTL を超えた pending (decision IS NULL) を回収する。
 *
 *  - DB 上は decision='expired', decided_by='timeout' に確定する (store.sweepExpired)。
 *  - 万一まだ in-memory queue に残っている (= gate がまだ生きている) entry は
 *    fail-safe の **deny** で決着させる。expired を allow として gate に返してはいけない。
 *    (gate は 300s で諦めて切断しているので、実際にはほぼ起きない防御的処理。)
 *
 * 呼び出し側は戻り値が空でなければ WS / relay へ最新 snapshot (queue.list()) を
 * 再送し、アプリ側の zombie カードを消す。
 *
 * @returns 回収した行 (確定前のスナップショット)。
 */
export function sweepStalePending(input: SweepStaleInput): ApprovalRequest[] {
  const { store, queue, now, ttlMs } = input;
  const swept = store.sweepExpired({ now, ttlMs });
  for (const req of swept) {
    if (queue.has(req.id)) {
      queue.resolve(req.id, "deny", "timeout:sweep", "gate timed out");
    }
  }
  return swept;
}

import type { ApprovalRequest, FinalDecision } from "@sentinel/shared";

export interface Resolution {
  decision: FinalDecision;
  /** 監査ログの decided_by に入る文字列。 */
  source: string;
  reason: string | null;
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (r: Resolution) => void;
  timer: NodeJS.Timeout;
}

type PendingListener = (req: ApprovalRequest) => void;
type ResolvedListener = (id: string, decision: FinalDecision) => void;

/**
 * 保留中の ask リクエストを ID → 待機者 で持つ in-memory queue。
 *
 * 役割:
 *  - ask 到着時、gate 接続のハンドラから enroll() を呼ぶと
 *    Promise<Resolution> が返る。誰かが resolve / cancel / timeout するまで待つ。
 *  - sentinel-cli / WS / タイムアウト いずれの経路でも decision が単一になる (二重解決を防ぐ)。
 *  - WS broadcast 用に pending / resolved の observer を提供する。
 */
export interface PendingQueue {
  enroll(req: ApprovalRequest, timeoutMs: number): Promise<Resolution>;
  resolve(id: string, decision: FinalDecision, source: string, reason: string | null): boolean;
  list(): ApprovalRequest[];
  has(id: string): boolean;
  cancelAll(reason: string): void;
  onPending(cb: PendingListener): () => void;
  onResolved(cb: ResolvedListener): () => void;
}

export function createPendingQueue(): PendingQueue {
  const entries = new Map<string, PendingEntry>();
  const pendingListeners = new Set<PendingListener>();
  const resolvedListeners = new Set<ResolvedListener>();

  function emitPending(req: ApprovalRequest): void {
    for (const cb of pendingListeners) {
      try {
        cb(req);
      } catch {
        // listener エラーは queue の動作に影響させない
      }
    }
  }

  function emitResolved(id: string, decision: FinalDecision): void {
    for (const cb of resolvedListeners) {
      try {
        cb(id, decision);
      } catch {
        // ignore
      }
    }
  }

  function settle(id: string, r: Resolution): boolean {
    const entry = entries.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    entries.delete(id);
    entry.resolve(r);
    emitResolved(id, r.decision);
    return true;
  }

  return {
    enroll(req, timeoutMs) {
      return new Promise<Resolution>((resolve) => {
        const timer = setTimeout(() => {
          if (entries.has(req.id)) {
            settle(req.id, {
              decision: "deny",
              source: "timeout",
              reason: `応答待ちタイムアウト (${timeoutMs}ms)`,
            });
          }
        }, timeoutMs);
        // Node.js: unref しておくとタイムアウトハンドルが event loop を止めない。
        // 但しテストで時計が回らないと困るので unref しない。
        entries.set(req.id, { request: req, resolve, timer });
        emitPending(req);
      });
    },
    resolve(id, decision, source, reason) {
      return settle(id, { decision, source, reason });
    },
    list() {
      return Array.from(entries.values()).map((e) => e.request);
    },
    has(id) {
      return entries.has(id);
    },
    cancelAll(reason) {
      for (const [id] of entries) {
        settle(id, { decision: "deny", source: "cancelled", reason });
      }
    },
    onPending(cb) {
      pendingListeners.add(cb);
      return () => {
        pendingListeners.delete(cb);
      };
    },
    onResolved(cb) {
      resolvedListeners.add(cb);
      return () => {
        resolvedListeners.delete(cb);
      };
    },
  };
}

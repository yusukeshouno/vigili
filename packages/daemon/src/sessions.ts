import type { HostedSession, HostedSessionStatus, SessionDaemonMessage } from "@vigili/shared";

/**
 * L4 ホスト型セッションの in-memory レジストリ (SPEC §8.5)。
 *
 * `vigili run` が unix socket (`kind:"session"`) で繋ぐと daemon はここに登録し、
 * transcript / question / plan / permission を WS でクライアントに fan-out する。
 * クライアントからの回答は request_id / session_id を頼りに、対応する runner の
 * socket 接続へ書き戻す。再起動で揮発する (永続化しない)。
 *
 * 加えて、gate 経由の素の Claude Code セッションも observe() で合成登録する
 * (SPEC §8.5.1)。こちらは conn を持たないため sendToSession 不可で、終了は
 * idle TTL (sweepIdleObserved) による近似。同一 session_id でホスト型が
 * register された場合はホスト型 (conn あり) が優先して上書きする。
 */

/** runner との socket 接続の最小インターフェース。socket.ts の ConnContext が構造的に満たす。 */
export interface SessionConn {
  send(value: unknown): void;
  isClosed(): boolean;
}

/** question / plan は queue を介さず request_id で直接回答するため対応づけを持つ。 */
export type PendingKind = "question" | "plan";

interface SessionEntry {
  session: HostedSession;
  /** null = gate 由来の observed session (SPEC §8.5.1)。 */
  conn: SessionConn | null;
  /** 最後に活動を観測した時刻 (ms)。observed session の idle 判定に使う。 */
  lastSeenAt: number;
}

/** observe() の入力。gate の ToolRequest から合成する。 */
export interface ObserveInput {
  session_id: string;
  tag: string | null;
  cwd: string;
  now: number;
}

export interface SessionRegistry {
  /** session-start を受けたら登録 (既存 session_id なら conn を差し替え)。 */
  register(session: HostedSession, conn: SessionConn): void;
  /**
   * gate の ToolRequest からセッションを合成 upsert する (SPEC §8.5.1)。
   * 新規作成なら created=true (呼び出し側が session-started を broadcast する)。
   * 既存 (hosted 含む) なら lastSeenAt だけ更新して created=false。
   */
  observe(input: ObserveInput): { session: HostedSession; created: boolean };
  get(sessionId: string): HostedSession | null;
  list(): HostedSession[];
  /** 状態遷移。存在すれば更新後の session を返す。 */
  setStatus(sessionId: string, status: HostedSessionStatus): HostedSession | null;
  /**
   * observed session (conn 無し) の status を pending の有無から再評価する。
   * pending あり→awaiting / なし→running。変化したものを返す。hosted は対象外
   * (question/plan 由来の awaiting を上書きしないため)。
   */
  reevaluateObserved(pendingSessionIds: ReadonlySet<string>): HostedSession[];
  /**
   * observed session (conn 無し) で idle TTL を超えたものを終了して返す。
   * hosted (conn あり) は切断検知で終了するため対象外。
   */
  sweepIdleObserved(now: number, ttlMs: number): HostedSession[];
  /** 明示的な終了。登録を消し、終了した session を返す (無ければ null)。 */
  end(sessionId: string): HostedSession | null;
  /** runner の conn 切断時に呼ぶ。その conn に紐づく session を終了して返す。 */
  endByConn(conn: SessionConn): HostedSession | null;
  /** request_id を session にひも付ける (後で client の回答を正しい conn に戻す)。 */
  trackRequest(requestId: string, sessionId: string, kind: PendingKind): void;
  /** request_id を解決し対応を取り出す (1 回限り)。 */
  takeRequest(requestId: string): { sessionId: string; kind: PendingKind } | null;
  /** session に daemon→runner メッセージを送る。conn が無い / 閉じていれば false。 */
  sendToSession(sessionId: string, msg: SessionDaemonMessage): boolean;
}

export function createSessionRegistry(): SessionRegistry {
  const entries = new Map<string, SessionEntry>();
  const requests = new Map<string, { sessionId: string; kind: PendingKind }>();

  const findBySid = (conn: SessionConn): string | null => {
    for (const [sid, entry] of entries) {
      if (entry.conn === conn) return sid;
    }
    return null;
  };

  const dropRequestsFor = (sessionId: string): void => {
    for (const [rid, rec] of requests) {
      if (rec.sessionId === sessionId) requests.delete(rid);
    }
  };

  const endSession = (sessionId: string): HostedSession | null => {
    const entry = entries.get(sessionId);
    if (!entry) return null;
    entries.delete(sessionId);
    dropRequestsFor(sessionId);
    return { ...entry.session, status: "ended" };
  };

  return {
    register(session, conn) {
      entries.set(session.session_id, { session, conn, lastSeenAt: Date.now() });
    },
    observe(input) {
      const existing = entries.get(input.session_id);
      if (existing) {
        existing.lastSeenAt = input.now;
        return { session: existing.session, created: false };
      }
      const session: HostedSession = {
        session_id: input.session_id,
        tag: input.tag,
        cwd: input.cwd,
        status: "running",
        started_at: input.now,
        observed: true,
      };
      entries.set(input.session_id, { session, conn: null, lastSeenAt: input.now });
      return { session, created: true };
    },
    get(sessionId) {
      return entries.get(sessionId)?.session ?? null;
    },
    list() {
      return Array.from(entries.values()).map((e) => e.session);
    },
    setStatus(sessionId, status) {
      const entry = entries.get(sessionId);
      if (!entry) return null;
      entry.session = { ...entry.session, status };
      return entry.session;
    },
    reevaluateObserved(pendingSessionIds) {
      const changed: HostedSession[] = [];
      for (const entry of entries.values()) {
        if (entry.conn !== null) continue;
        const desired: HostedSessionStatus = pendingSessionIds.has(entry.session.session_id)
          ? "awaiting"
          : "running";
        if (entry.session.status !== desired) {
          entry.session = { ...entry.session, status: desired };
          changed.push(entry.session);
        }
      }
      return changed;
    },
    sweepIdleObserved(now, ttlMs) {
      const ended: HostedSession[] = [];
      for (const [sid, entry] of entries) {
        if (entry.conn !== null) continue;
        if (now - entry.lastSeenAt < ttlMs) continue;
        const e = endSession(sid);
        if (e) ended.push(e);
      }
      return ended;
    },
    end(sessionId) {
      return endSession(sessionId);
    },
    endByConn(conn) {
      const sid = findBySid(conn);
      if (sid === null) return null;
      return endSession(sid);
    },
    trackRequest(requestId, sessionId, kind) {
      requests.set(requestId, { sessionId, kind });
    },
    takeRequest(requestId) {
      const rec = requests.get(requestId);
      if (!rec) return null;
      requests.delete(requestId);
      return rec;
    },
    sendToSession(sessionId, msg) {
      const entry = entries.get(sessionId);
      if (!entry || entry.conn === null || entry.conn.isClosed()) return false;
      entry.conn.send(msg);
      return true;
    },
  };
}

import type { HostedSession, HostedSessionStatus, SessionDaemonMessage } from "@vigili/shared";

/**
 * L4 ホスト型セッションの in-memory レジストリ (SPEC §8.5)。
 *
 * `vigili run` が unix socket (`kind:"session"`) で繋ぐと daemon はここに登録し、
 * transcript / question / plan / permission を WS でクライアントに fan-out する。
 * クライアントからの回答は request_id / session_id を頼りに、対応する runner の
 * socket 接続へ書き戻す。再起動で揮発する (永続化しない)。
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
  conn: SessionConn;
}

export interface SessionRegistry {
  /** session-start を受けたら登録 (既存 session_id なら conn を差し替え)。 */
  register(session: HostedSession, conn: SessionConn): void;
  get(sessionId: string): HostedSession | null;
  list(): HostedSession[];
  /** 状態遷移。存在すれば更新後の session を返す。 */
  setStatus(sessionId: string, status: HostedSessionStatus): HostedSession | null;
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
      entries.set(session.session_id, { session, conn });
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
      if (!entry || entry.conn.isClosed()) return false;
      entry.conn.send(msg);
      return true;
    },
  };
}

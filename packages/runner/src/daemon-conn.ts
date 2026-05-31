import { randomUUID } from "node:crypto";
import { type Socket, createConnection } from "node:net";
import {
  type Question,
  type SessionDaemonMessage,
  SessionDaemonMessageSchema,
  type SessionRunnerMessage,
  type TranscriptLine,
} from "@vigili/shared";

/** Fail-safe reason used when the daemon socket drops with requests in flight. */
const DISCONNECT = "daemon disconnected";

export interface PermissionOutcome {
  decision: "allow" | "deny";
  reason?: string;
}

export interface PlanOutcome {
  decision: "approve" | "reject";
  reason?: string;
}

/**
 * Runner-side handle on the daemon's unix socket (`kind:"session"`).
 *
 * The runner sends session lifecycle / transcript / permission / question / plan
 * messages; the daemon replies with decisions and free-text replies. Pending
 * requests are keyed by request_id and resolved once (delete-on-read), mirroring
 * the daemon's own SessionRegistry.
 *
 * On disconnect, every in-flight request fails safe: permissions deny, plans
 * reject, questions resolve to null (the caller then denies the tool).
 */
export interface DaemonConn {
  /** The session_id this connection registered under (a runner-minted UUID). */
  readonly sessionId: string;
  /** Announce the session to the daemon. Call once, before anything else. */
  start(tag: string | null, cwd: string): void;
  /** Append a transcript line (fan-out to phone/desktop clients). */
  transcript(line: TranscriptLine): void;
  /** Ask the daemon to classify a tool permission (policy engine + queue). */
  requestPermission(
    toolName: string,
    toolInput: Record<string, unknown>,
    cwd?: string,
  ): Promise<PermissionOutcome>;
  /** Forward an AskUserQuestion. Resolves with answers, or null on disconnect. */
  askQuestion(questions: Question[]): Promise<Record<string, string> | null>;
  /** Forward an ExitPlanMode plan for approval. */
  requestPlan(plan: string): Promise<PlanOutcome>;
  /** Register a callback for free-text replies (next user turn from a client). */
  onReply(cb: (body: string) => void): void;
  /** Tell the daemon the session is over. */
  end(reason?: string): void;
  /** Tear down the socket. */
  close(): void;
  isClosed(): boolean;
}

/**
 * Connect to the daemon socket. Resolves with a DaemonConn on success, or null
 * if the socket can't be reached within `timeoutMs` (the caller then falls back
 * to local terminal handling).
 */
export function connectDaemon(socketPath: string, timeoutMs = 500): Promise<DaemonConn | null> {
  return new Promise((resolve) => {
    const conn = createConnection(socketPath);
    const timer = setTimeout(() => {
      conn.destroy();
      resolve(null);
    }, timeoutMs);

    conn.once("connect", () => {
      clearTimeout(timer);
      resolve(makeConn(conn));
    });
    conn.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/** One in-flight request awaiting a daemon reply. */
interface Pending {
  /** A matching daemon message arrived. */
  onMessage(msg: SessionDaemonMessage): void;
  /** The socket dropped before a reply; resolve fail-safe. */
  onFail(): void;
}

function makeConn(conn: Socket): DaemonConn {
  const sessionId = randomUUID();
  const pending = new Map<string, Pending>();
  let replyCb: ((body: string) => void) | null = null;
  let closed = false;

  const send = (msg: SessionRunnerMessage): void => {
    if (closed) {
      return;
    }
    try {
      conn.write(`${JSON.stringify(msg)}\n`);
    } catch {
      // best-effort; a failed write surfaces via the close/error handlers
    }
  };

  const failAllPending = (): void => {
    for (const [, p] of pending) {
      p.onFail();
    }
    pending.clear();
  };

  conn.setEncoding("utf-8");
  let buffer = "";
  conn.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      dispatch(line);
      nl = buffer.indexOf("\n");
    }
  });
  conn.on("error", () => {
    closed = true;
    failAllPending();
  });
  conn.on("close", () => {
    closed = true;
    failAllPending();
  });

  const dispatch = (line: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const result = SessionDaemonMessageSchema.safeParse(parsed);
    if (!result.success) {
      return;
    }
    const msg = result.data;
    if (msg.type === "reply") {
      replyCb?.(msg.body);
      return;
    }
    if (msg.type === "session-error") {
      console.error(`[vigili] daemon session error: ${msg.error}`);
      return;
    }
    const p = pending.get(msg.request_id);
    if (p) {
      pending.delete(msg.request_id);
      p.onMessage(msg);
    }
  };

  return {
    sessionId,
    start(tag, cwd) {
      send({ kind: "session", type: "session-start", session_id: sessionId, tag, cwd });
    },
    transcript(line) {
      send({ kind: "session", type: "transcript-append", session_id: sessionId, line });
    },
    requestPermission(toolName, toolInput, cwd) {
      const requestId = randomUUID();
      return new Promise<PermissionOutcome>((resolve) => {
        if (closed) {
          resolve({ decision: "deny", reason: DISCONNECT });
          return;
        }
        pending.set(requestId, {
          onMessage: (msg) => {
            if (msg.type === "permission-decision") {
              resolve({
                decision: msg.decision,
                ...(msg.reason !== undefined ? { reason: msg.reason } : {}),
              });
            } else {
              resolve({ decision: "deny", reason: "unexpected daemon response" });
            }
          },
          onFail: () => resolve({ decision: "deny", reason: DISCONNECT }),
        });
        send({
          kind: "session",
          type: "permission-request",
          session_id: sessionId,
          request_id: requestId,
          tool_name: toolName,
          tool_input: toolInput,
          ...(cwd !== undefined ? { cwd } : {}),
        });
      });
    },
    askQuestion(questions) {
      const requestId = randomUUID();
      return new Promise<Record<string, string> | null>((resolve) => {
        if (closed) {
          resolve(null);
          return;
        }
        pending.set(requestId, {
          onMessage: (msg) => resolve(msg.type === "answer" ? msg.answers : null),
          onFail: () => resolve(null),
        });
        send({
          kind: "session",
          type: "question",
          session_id: sessionId,
          request_id: requestId,
          questions,
        });
      });
    },
    requestPlan(plan) {
      const requestId = randomUUID();
      return new Promise<PlanOutcome>((resolve) => {
        if (closed) {
          resolve({ decision: "reject", reason: DISCONNECT });
          return;
        }
        pending.set(requestId, {
          onMessage: (msg) => {
            if (msg.type === "plan-decision") {
              resolve({
                decision: msg.decision,
                ...(msg.reason !== undefined ? { reason: msg.reason } : {}),
              });
            } else {
              resolve({ decision: "reject", reason: "unexpected daemon response" });
            }
          },
          onFail: () => resolve({ decision: "reject", reason: DISCONNECT }),
        });
        send({
          kind: "session",
          type: "plan",
          session_id: sessionId,
          request_id: requestId,
          plan,
        });
      });
    },
    onReply(cb) {
      replyCb = cb;
    },
    end(reason) {
      send({
        kind: "session",
        type: "session-end",
        session_id: sessionId,
        ...(reason !== undefined ? { reason } : {}),
      });
    },
    close() {
      closed = true;
      conn.destroy();
    },
    isClosed() {
      return closed;
    },
  };
}

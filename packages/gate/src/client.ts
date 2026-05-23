import { type Socket, createConnection } from "node:net";
import {
  type AskResolution,
  AskResolutionSchema,
  type Decision,
  DecisionSchema,
  type ToolRequest,
} from "@sentinel/shared";

export interface GateClientOptions {
  socketPath: string;
  /** daemon への接続を諦めるまでのミリ秒。SPEC: 500ms */
  connectTimeoutMs?: number;
  /** ask 後の決着待ちタイムアウト (ミリ秒)。デフォルト 5 分。 */
  askTimeoutMs?: number;
  /** 内部フェーズログ (デバッグ用フック)。 */
  trace?: (event: string, detail?: unknown) => void;
}

export class GateConnectionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "GateConnectionError";
  }
}

export type GateResult =
  | { decision: "allow"; reason?: string }
  | { decision: "deny"; reason?: string };

/**
 * gate のクライアント本体。
 *
 * Phase 3: allow/deny を受けて結果を返す。
 * - daemon が "ask" を返した場合は decision: deny を返す (Phase 4 で同じソケット上で待つよう拡張する)。
 * - 接続失敗 / タイムアウト / 不正レスポンスは全て GateConnectionError として throw する。
 */
export async function sendToDaemon(
  req: ToolRequest,
  options: GateClientOptions,
): Promise<GateResult> {
  const trace = options.trace ?? (() => undefined);
  trace("connect");
  const conn = await connectWithTimeout(options.socketPath, options.connectTimeoutMs ?? 500);
  trace("connected");
  try {
    return await exchange(conn, req, options.askTimeoutMs ?? 5 * 60_000, trace);
  } finally {
    conn.destroy();
  }
}

function connectWithTimeout(socketPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const conn = createConnection(socketPath);
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new GateConnectionError(`daemon に接続できません (timeout ${timeoutMs}ms)`));
    }, timeoutMs);
    conn.once("connect", () => {
      clearTimeout(timer);
      resolve(conn);
    });
    conn.once("error", (err) => {
      clearTimeout(timer);
      reject(new GateConnectionError(`daemon socket への接続失敗: ${err.message}`, err));
    });
  });
}

async function exchange(
  conn: Socket,
  req: ToolRequest,
  askTimeoutMs: number,
  trace: (event: string, detail?: unknown) => void,
): Promise<GateResult> {
  const reader = lineReader(conn);
  conn.write(`${JSON.stringify(req)}\n`);
  trace("request sent");

  const first = await reader.next(askTimeoutMs);
  trace("first response received", first);
  const parsed = parseLine(first, DecisionSchema, "Decision");

  if (parsed.decision === "allow") {
    return parsed.reason !== undefined
      ? { decision: "allow", reason: parsed.reason }
      : { decision: "allow" };
  }
  if (parsed.decision === "deny") {
    return parsed.reason !== undefined
      ? { decision: "deny", reason: parsed.reason }
      : { decision: "deny" };
  }

  // ask: 同じソケット上で resolution を待つ
  trace("ask received, waiting for resolution", parsed.request_id);
  return await waitForResolution(reader, parsed.request_id, askTimeoutMs);
}

async function waitForResolution(
  reader: LineReader,
  requestId: string,
  timeoutMs: number,
): Promise<GateResult> {
  const next = await reader.next(timeoutMs).catch((err: unknown) => {
    throw new GateConnectionError(`ask の決着を待ち中にエラー: ${(err as Error).message}`, err);
  });
  const resolution: AskResolution = parseLine(next, AskResolutionSchema, "AskResolution");
  if (resolution.request_id !== requestId) {
    throw new GateConnectionError(
      `ask に対する resolution の request_id が一致しません: expected=${requestId} got=${resolution.request_id}`,
    );
  }
  return resolution.reason !== undefined
    ? { decision: resolution.decision, reason: resolution.reason }
    : { decision: resolution.decision };
}

function parseLine<T>(
  line: string,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  what: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new GateConnectionError(`daemon から不正な JSON: ${line}`, err);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new GateConnectionError(`daemon からの ${what} がスキーマ違反: ${line}`);
  }
  return result.data;
}

interface LineReader {
  next(timeoutMs: number): Promise<string>;
}

function lineReader(conn: Socket): LineReader {
  let buffer = "";
  const queue: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let errored: Error | null = null;
  const failWaiters = (err: Error): void => {
    errored = err;
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (w) w(`__ERROR__${err.message}`);
    }
  };

  conn.setEncoding("utf-8");
  conn.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else queue.push(line);
      nl = buffer.indexOf("\n");
    }
  });
  conn.on("error", (err) => failWaiters(err));
  conn.on("close", () => {
    if (waiters.length > 0) {
      failWaiters(new Error("daemon socket closed before sending response"));
    }
  });

  return {
    next(timeoutMs: number): Promise<string> {
      if (errored) return Promise.reject(errored);
      const queued = queue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(waiter);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new GateConnectionError(`daemon 応答待ちタイムアウト (${timeoutMs}ms)`));
        }, timeoutMs);
        const waiter = (line: string): void => {
          clearTimeout(timer);
          if (line.startsWith("__ERROR__")) {
            reject(new GateConnectionError(line.slice("__ERROR__".length)));
          } else {
            resolve(line);
          }
        };
        waiters.push(waiter);
      });
    },
  };
}

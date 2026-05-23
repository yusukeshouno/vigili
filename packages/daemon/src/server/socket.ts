import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { type Socket, createServer } from "node:net";
import { dirname } from "node:path";

/**
 * Unix domain socket サーバ。改行区切り JSON。
 *
 * Phase 4 から: 1 接続 / 1 リクエストではなく、ハンドラが ConnContext.send() で
 * 任意の数のメッセージを書ける形にした (ask の "ask → resolution" のような複数応答用)。
 */

export interface ConnContext {
  send(value: unknown): void;
  close(): void;
  onClose(cb: () => void): void;
  /** クライアントが既に切断していたら true。 */
  isClosed(): boolean;
}

export type LineHandler = (line: string, conn: ConnContext) => Promise<void>;

export interface SocketServer {
  close(): Promise<void>;
}

export function startSocketServer(socketPath: string, handler: LineHandler): SocketServer {
  mkdirSync(dirname(socketPath), { recursive: true });
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const server = createServer((conn: Socket) => {
    bind(conn, handler);
  });

  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o600);
    } catch {
      // chmod が動かない FS では諦める (Unix のみ前提なので普通は問題ない)
    }
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          if (existsSync(socketPath)) {
            try {
              unlinkSync(socketPath);
            } catch {
              // already cleaned up
            }
          }
          resolve();
        });
      }),
  };
}

function bind(conn: Socket, handler: LineHandler): void {
  let buffer = "";
  let closed = false;
  const closeListeners = new Set<() => void>();

  const ctx: ConnContext = {
    send(value) {
      if (closed) return;
      try {
        conn.write(`${JSON.stringify(value)}\n`);
      } catch {
        // 書き込み失敗 = ピアが落ちた。閉じる。
        ctx.close();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        conn.end();
      } catch {
        // ignore
      }
    },
    onClose(cb) {
      closeListeners.add(cb);
    },
    isClosed() {
      return closed;
    },
  };

  conn.setEncoding("utf-8");
  conn.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      void runHandler(handler, line, ctx);
      nl = buffer.indexOf("\n");
    }
  });
  conn.on("error", () => {
    ctx.close();
  });
  conn.on("close", () => {
    closed = true;
    for (const cb of closeListeners) {
      try {
        cb();
      } catch {
        // ignore
      }
    }
    closeListeners.clear();
  });
}

async function runHandler(handler: LineHandler, line: string, ctx: ConnContext): Promise<void> {
  const trimmed = line.trim();
  if (trimmed === "") return;
  try {
    await handler(trimmed, ctx);
  } catch (err) {
    ctx.send({ ok: false, error: `handler error: ${(err as Error).message}` });
  }
}

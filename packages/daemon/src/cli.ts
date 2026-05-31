#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createConnection } from "node:net";
import { startDaemon } from "./daemon.js";
import { paths } from "./paths.js";
import { PolicyLoadError } from "./policy/loader.js";
import { runSetupQr } from "./setup-qr.js";

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case "start":
      return start(rest);
    case "stop":
      return stop();
    case "status":
      return status();
    case "qr":
      return runSetupQr(rest);
    case "version":
    case "--version":
    case "-v": {
      const { SENTINEL_DAEMON_VERSION } = await import("./version.js");
      console.log(SENTINEL_DAEMON_VERSION);
      return 0;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return cmd === undefined ? 1 : 0;
    default:
      console.error(`unknown command: ${cmd}`);
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  console.log(`Usage: vigili-daemon <command>

Commands:
  start              Run the daemon in the foreground (use launchd for daemonization).
  stop               Stop the running daemon (via PID file).
  status             Show whether the daemon is running.
  qr                 Show pairing QR for the Vigili iOS app.
      --url <url>    Override daemon URL (default: auto-detect LAN IP / Tailscale)
      --plain        Print only the vigili:// URL (no QR)
  version            Print version.

Files:
  ~/.vigili/policy.yaml   Policy rules (validated on start).
  ~/.vigili/daemon.sock   Unix socket (gate connects here).
  ~/.vigili/queue.db      SQLite audit log.
  ~/.vigili/daemon.pid    PID of the running daemon.
`);
}

async function start(_args: string[]): Promise<number> {
  const p = paths();

  // PID file guard: 生きているプロセスが既にあれば再起動しない。
  if (existsSync(p.pid)) {
    const rawPid = readFileSync(p.pid, "utf-8").trim();
    const pid = Number(rawPid);
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        console.error(`[vigili-daemon] 既に動作中 (pid=${pid})。先に stop してください。`);
        return 1;
      } catch {
        // PID が死んでいる → stale PID file を掃除して続行
        console.error(`[vigili-daemon] stale PID ${pid} を削除して再起動します。`);
        try {
          unlinkSync(p.pid);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ゾンビプロセスが port 7878 を掴んでいたら kill してから起動する。
  await killPortHolders(7878);

  try {
    const daemon = await startDaemon();

    const shutdown = async (sig: string): Promise<void> => {
      console.error(`[vigili-daemon] received ${sig}, shutting down`);
      await daemon.close();
      const p = paths();
      if (existsSync(p.pid)) {
        try {
          unlinkSync(p.pid);
        } catch {
          // ignore
        }
      }
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    // foreground 起動: イベントループを残すために何もしない。
    return await new Promise(() => {
      // 永久待機
    });
  } catch (err) {
    if (err instanceof PolicyLoadError) {
      console.error(`[vigili-daemon] ポリシーロード失敗: ${err.message}`);
      return 2;
    }
    console.error("[vigili-daemon] 起動失敗:", err);
    return 1;
  }
}

function stop(): number {
  const p = paths();
  if (!existsSync(p.pid)) {
    console.log("daemon is not running");
    return 0;
  }
  const pid = Number(readFileSync(p.pid, "utf-8").trim());
  if (!Number.isFinite(pid)) {
    console.error(`invalid PID file: ${p.pid}`);
    return 1;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`sent SIGTERM to ${pid}`);
    return 0;
  } catch (err) {
    console.error(`failed to signal ${pid}:`, (err as Error).message);
    try {
      unlinkSync(p.pid);
    } catch {
      // ignore
    }
    return 1;
  }
}

async function status(): Promise<number> {
  const p = paths();
  if (!existsSync(p.pid)) {
    console.log("not running (no pid file)");
    return 3;
  }
  const pid = Number(readFileSync(p.pid, "utf-8").trim());
  let pidAlive = false;
  try {
    process.kill(pid, 0);
    pidAlive = true;
  } catch {
    pidAlive = false;
  }

  const socketReachable = await pingSocket(p.socket);
  console.log(`pid file:          ${p.pid} (pid=${pid}, alive=${pidAlive})`);
  console.log(`socket:            ${p.socket} (reachable=${socketReachable})`);
  return pidAlive && socketReachable ? 0 : 3;
}

/** lsof で port を掴んでいる全プロセスを SIGKILL して、OS がポートを解放するまで待つ。 */
async function killPortHolders(port: number): Promise<void> {
  const result = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf-8" });
  if (result.status !== 0 || !result.stdout.trim()) return;
  const pids = result.stdout
    .trim()
    .split("\n")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      console.error(`[vigili-daemon] killed zombie on port ${port} (pid=${pid})`);
    } catch {
      // already dead
    }
  }
  if (pids.length > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
}

function pingSocket(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(path)) return resolve(false);
    const conn = createConnection(path);
    const finish = (ok: boolean): void => {
      conn.destroy();
      resolve(ok);
    };
    conn.once("connect", () => finish(true));
    conn.once("error", () => finish(false));
    setTimeout(() => finish(false), 500);
  });
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);

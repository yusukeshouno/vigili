#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createConnection } from "node:net";
import { startDaemon } from "./daemon.js";
import { paths } from "./paths.js";
import { PolicyLoadError } from "./policy/loader.js";

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case "start":
      return start(rest);
    case "stop":
      return stop();
    case "status":
      return status();
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
  console.log(`Usage: sentinel-daemon <command>

Commands:
  start              Run the daemon in the foreground (use launchd for daemonization).
  stop               Stop the running daemon (via PID file).
  status             Show whether the daemon is running.
  version            Print version.

Files:
  ~/.sentinel/policy.yaml   Policy rules (validated on start).
  ~/.sentinel/daemon.sock   Unix socket (gate connects here).
  ~/.sentinel/queue.db      SQLite audit log.
  ~/.sentinel/daemon.pid    PID of the running daemon.
`);
}

async function start(_args: string[]): Promise<number> {
  try {
    const daemon = await startDaemon();

    const shutdown = async (sig: string): Promise<void> => {
      console.error(`[sentinel-daemon] received ${sig}, shutting down`);
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
      console.error(`[sentinel-daemon] ポリシーロード失敗: ${err.message}`);
      return 2;
    }
    console.error("[sentinel-daemon] 起動失敗:", err);
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

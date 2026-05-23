#!/usr/bin/env node
/**
 * 起動エントリ。Phase 14-A の API + WS を立ち上げる。
 *
 * Env:
 *   PORT       (default 3030)
 *   HOST       (default 0.0.0.0)
 *   RELAY_DB   (default ~/.sentinel/relay.db、":memory:" 可)
 */

import { startRelay } from "./index.js";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? "3030");
  const host = process.env.HOST ?? "0.0.0.0";
  const dbPath = process.env.RELAY_DB ?? `${process.env.HOME ?? ""}/.sentinel/relay.db`;

  const running = await startRelay({ port, host, dbPath });

  const shutdown = async (sig: string): Promise<void> => {
    console.error(`[relay] received ${sig}, shutting down`);
    await running.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

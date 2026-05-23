#!/usr/bin/env node
import { startRelay } from "./index.js";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? "3030");
  const host = process.env.HOST ?? "0.0.0.0";
  await startRelay({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

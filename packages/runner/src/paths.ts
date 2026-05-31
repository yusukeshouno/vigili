import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the daemon's unix socket path the same way the daemon does
 * (`packages/daemon/src/paths.ts`). The runner can't import daemon internals
 * (it doesn't depend on that package), so this minimal copy keeps them in sync.
 *
 * Override with $VIGILI_HOME (or legacy $SENTINEL_HOME). During the rebrand,
 * if ~/.vigili is absent but ~/.sentinel exists, fall back to the latter.
 */
export function daemonSocketPath(): string {
  return join(vigiliHome(), "daemon.sock");
}

function vigiliHome(): string {
  const override = process.env.VIGILI_HOME ?? process.env.SENTINEL_HOME;
  if (override) {
    return override;
  }
  const newHome = join(homedir(), ".vigili");
  const oldHome = join(homedir(), ".sentinel");
  if (!existsSync(newHome) && existsSync(oldHome)) {
    return oldHome;
  }
  return newHome;
}

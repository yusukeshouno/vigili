#!/usr/bin/env node
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { runSession } from "./session.js";

const PERMISSION_MODES: ReadonlySet<PermissionMode> = new Set<PermissionMode>([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
]);

function isPermissionMode(v: string): v is PermissionMode {
  return PERMISSION_MODES.has(v as PermissionMode);
}

function printHelp(): void {
  console.log(`vigili — host a Claude Code session under Vigili

Usage:
  vigili run [options] [prompt]

Options:
  --tag <name>              Label for this session (shown by the daemon later)
  --cwd <path>              Working directory (default: current directory)
  --permission-mode <mode>  One of: default | acceptEdits | bypassPermissions
                            | plan | dontAsk | auto
  --local                   Force local terminal handling (skip the daemon)
  -h, --help                Show this help

If [prompt] is omitted, vigili asks for it interactively.`);
}

interface RunArgs {
  tag: string | null;
  cwd: string;
  permissionMode: PermissionMode | null;
  initialPrompt: string | null;
  local: boolean;
}

/** Parse the args following `run`. Returns null on a usage error (already logged). */
function parseRunArgs(argv: string[]): RunArgs | null {
  let tag: string | null = null;
  let cwd: string = process.cwd();
  let permissionMode: PermissionMode | null = null;
  let local = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    switch (arg) {
      case "--tag": {
        const v = argv[++i];
        if (v === undefined) {
          console.error("--tag requires a value");
          return null;
        }
        tag = v;
        break;
      }
      case "--cwd": {
        const v = argv[++i];
        if (v === undefined) {
          console.error("--cwd requires a value");
          return null;
        }
        cwd = v;
        break;
      }
      case "--permission-mode": {
        const v = argv[++i];
        if (v === undefined) {
          console.error("--permission-mode requires a value");
          return null;
        }
        if (!isPermissionMode(v)) {
          console.error(`invalid permission mode: ${v}`);
          return null;
        }
        permissionMode = v;
        break;
      }
      case "--local": {
        local = true;
        break;
      }
      default: {
        positional.push(arg);
        break;
      }
    }
  }

  const initialPrompt = positional.length > 0 ? positional.join(" ") : null;
  return { tag, cwd, permissionMode, initialPrompt, local };
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case "run": {
      const args = parseRunArgs(rest);
      if (args === null) {
        return 2;
      }
      return runSession(args);
    }
    case "-h":
    case "--help":
    case "help":
    case undefined: {
      printHelp();
      return 0;
    }
    default: {
      console.error(`unknown command: ${cmd}`);
      printHelp();
      return 2;
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });

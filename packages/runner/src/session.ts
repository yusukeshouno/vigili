import { createInterface } from "node:readline";
import {
  type Options,
  type PermissionMode,
  type SDKUserMessage,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { type DaemonConn, connectDaemon } from "./daemon-conn.js";
import { type Io, createIo } from "./io.js";
import { daemonSocketPath } from "./paths.js";
import { makeDaemonCanUseTool, makeLocalCanUseTool } from "./permission.js";
import { renderMessage, toTranscriptLines } from "./render.js";

export interface RunOptions {
  /** Working directory the session operates in. */
  cwd: string;
  /** Optional human-facing label for the session (shown by the daemon / clients). */
  tag: string | null;
  /** Permission mode override, or null to use the SDK default. */
  permissionMode: PermissionMode | null;
  /** First prompt; when null the runner asks for it interactively. */
  initialPrompt: string | null;
  /** Force local terminal handling even when a daemon is reachable. */
  local: boolean;
}

/** Construct a streaming user-turn message. */
function userMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

interface ReplyChannel {
  /** Async generator suitable for passing to `query({ prompt })`. */
  stream(): AsyncGenerator<SDKUserMessage, void>;
  /** Queue a new user turn. */
  push(text: string): void;
  /** Signal that no further turns will be sent; ends the stream. */
  end(): void;
}

/**
 * A buffered, wake-on-push channel that feeds user turns into the SDK's
 * streaming-input mode. The main loop pushes replies; the generator yields them.
 */
function makeReplyChannel(): ReplyChannel {
  const buffer: (SDKUserMessage | null)[] = [];
  let wake: (() => void) | null = null;
  let ended = false;

  const notify = (): void => {
    if (wake !== null) {
      const w = wake;
      wake = null;
      w();
    }
  };

  return {
    push(text: string): void {
      if (ended) {
        return;
      }
      buffer.push(userMessage(text));
      notify();
    },
    end(): void {
      if (ended) {
        return;
      }
      ended = true;
      buffer.push(null);
      notify();
    },
    async *stream(): AsyncGenerator<SDKUserMessage, void> {
      while (true) {
        if (buffer.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        const next = buffer.shift();
        if (next === undefined) {
          continue;
        }
        if (next === null) {
          return;
        }
        yield next;
      }
    },
  };
}

/**
 * Drive a single hosted Claude Code session. If a Vigili daemon is reachable
 * (and `--local` was not given) the session is registered with it and all
 * permission / question / plan / transcript traffic flows through the daemon so
 * it can be controlled from a phone. Otherwise it falls back to local terminal
 * prompts. Returns a process exit code.
 */
export async function runSession(opts: RunOptions): Promise<number> {
  const io = createIo();
  const first = opts.initialPrompt ?? (await io.ask("you> "));
  if (first.trim() === "") {
    io.close();
    console.error("No prompt given; nothing to do.");
    return 1;
  }

  const conn = opts.local ? null : await connectDaemon(daemonSocketPath());
  if (conn !== null) {
    // The daemon path uses its own line-mode stdin reader.
    io.close();
    console.log(`[vigili] connected to daemon · session ${conn.sessionId}`);
    return runDaemonSession(conn, opts, first);
  }

  if (!opts.local) {
    console.log("[vigili] daemon not reachable — running locally (terminal approvals)");
  }
  return runLocalSession(io, opts, first);
}

/** P0.5 behavior: resolve permissions / questions / plans at the local terminal. */
async function runLocalSession(io: Io, opts: RunOptions, first: string): Promise<number> {
  const channel = makeReplyChannel();
  const canUseTool = makeLocalCanUseTool(io);

  if (opts.tag !== null) {
    console.log(`[vigili] session tag=${opts.tag} cwd=${opts.cwd}`);
  }

  channel.push(first);

  const options: Options = { cwd: opts.cwd, canUseTool };
  if (opts.permissionMode !== null) {
    options.permissionMode = opts.permissionMode;
  }

  let exitCode = 0;
  try {
    const q = query({ prompt: channel.stream(), options });
    for await (const message of q) {
      renderMessage(message);
      if (message.type === "result") {
        if (message.is_error) {
          exitCode = 1;
          channel.end();
          break;
        }
        const reply = await io.ask("\nyou> (empty to end) ");
        if (reply.trim() === "") {
          channel.end();
        } else {
          channel.push(reply);
        }
      }
    }
  } finally {
    io.close();
  }

  return exitCode;
}

/**
 * Daemon-backed session: register with the daemon, route permissions through the
 * Vigili policy engine, fan transcript out to clients, and accept follow-up
 * turns from either the phone (daemon `reply`) or the local terminal.
 */
async function runDaemonSession(
  conn: DaemonConn,
  opts: RunOptions,
  first: string,
): Promise<number> {
  const channel = makeReplyChannel();
  const canUseTool = makeDaemonCanUseTool(conn);
  let ended = false;
  const finish = (): void => {
    if (!ended) {
      ended = true;
      channel.end();
    }
  };

  conn.start(opts.tag, opts.cwd);
  conn.onReply((body) => {
    console.log(`\n[remote] you> ${body}`);
    channel.push(body);
  });

  // Local stdin also drives turns; an empty line ends the session.
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const text = line.trim();
    if (text === "") {
      finish();
    } else {
      channel.push(text);
    }
  });

  // First user turn: push to the SDK and mirror into the transcript.
  channel.push(first);
  conn.transcript({ role: "user", text: first, at: Date.now() });

  const options: Options = { cwd: opts.cwd, canUseTool };
  if (opts.permissionMode !== null) {
    options.permissionMode = opts.permissionMode;
  }

  let exitCode = 0;
  try {
    const q = query({ prompt: channel.stream(), options });
    for await (const message of q) {
      renderMessage(message);
      for (const line of toTranscriptLines(message)) {
        conn.transcript(line);
      }
      if (message.type === "result") {
        if (message.is_error) {
          exitCode = 1;
          finish();
          break;
        }
        console.log("\n[turn complete] reply from your phone, or type here (empty line ends)");
      }
    }
  } finally {
    rl.close();
    conn.end(exitCode === 1 ? "session error" : "session complete");
    conn.close();
  }

  return exitCode;
}

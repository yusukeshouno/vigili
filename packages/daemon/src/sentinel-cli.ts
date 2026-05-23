#!/usr/bin/env node
import { createConnection } from "node:net";
import type { ApprovalRequest, FinalDecision } from "@vigili/shared";
import { computeStats, type StatsBuckets } from "./db/stats.js";
import { openStore } from "./db/store.js";
import { paths } from "./paths.js";
import { pair as pairCommand } from "./pair.js";
import { type AdminResponse, AdminResponseSchema } from "./server/admin.js";

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case "history":
      return history(rest);
    case "pending":
      return pending();
    case "approve":
      return resolve("allow", rest);
    case "deny":
      return resolve("deny", rest);
    case "reload":
      return reload();
    case "stats":
      return stats(rest);
    case "setup-qr":
      return setupQr(rest);
    case "setup-link":
      return setupLink(rest);
    case "pair":
      return pairCommand(rest);
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
  console.log(`Usage: sentinel-cli <command>

Commands:
  pending                  Show requests still awaiting a decision (live).
  approve <id> [reason]    Approve a pending request (gate is released).
  deny <id> [reason]       Deny a pending request.
  reload                   Reload policy.yaml + policy.generated.yaml in the daemon.
  history [--limit N]      Show recent decisions from DB (default 20).
  stats [options]          Aggregate decision stats.
      --today              Since 00:00 of the local day (default)
      --since <duration>   Since now - duration (e.g. 1h, 6h, 7d)
      --json               Emit raw JSON (for scripts)
  setup-qr                 Print QR. iPhone Camera.app or Sentinel.app scans → connect.
      --url <url>          Override daemon URL (default: detect via Tailscale)
      --json               Encode {"u":...,"t":...} JSON instead of sentinel:// URL
      --plain              Print only the payload (no QR)
  setup-link               Print a sentinel:// URL. AirDrop / iMessage it to iPhone.
      --url <url>          Override daemon URL (default: detect via Tailscale)
      --copy               Copy URL to clipboard (pbcopy)
      --open               Open the URL via macOS open(1) (for testing on this Mac)
  pair                     Pair with Vigili Cloud Relay for outbound mode.
                           Signs in (or signs up) to relay, creates a pairing,
                           writes relay: into ~/.vigili/config.yaml, prints QR.
      --relay <url>        Relay base URL (default: https://relay.vigili.io)
      --name <name>        Pairing label (e.g. "macbook-air")
      --email <email>      Email (otherwise prompted interactively)
      --signup             Create a new account instead of signing in
      --plain              Print only the vigili:// URL (no QR)
      --no-config          Don't write to ~/.vigili/config.yaml (dry-run)
`);
}

function history(args: string[]): number {
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1] ?? "20") : 20;
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`invalid --limit: ${args[limitIdx + 1]}`);
    return 1;
  }

  const p = paths();
  const store = openStore(p.db);
  try {
    const rows = store.listRecent(limit);
    if (rows.length === 0) {
      console.log("(no entries)");
      return 0;
    }
    for (const r of rows) {
      const when = new Date(r.created_at).toISOString();
      const decision = r.decision ?? "pending";
      const tool = r.tool_name;
      const summary = summarize(tool, r.tool_input);
      console.log(`${when}  ${decision.padEnd(8)}  ${tool.padEnd(8)}  ${summary}`);
      if (r.decided_by) console.log(`                                    by: ${r.decided_by}`);
    }
    return 0;
  } finally {
    store.close();
  }
}

async function pending(): Promise<number> {
  const p = paths();
  let resp: AdminResponse;
  try {
    resp = await sendAdmin(p.socket, { kind: "admin", action: "pending" });
  } catch (err) {
    console.error(`[vigili-cli] daemon に接続できません: ${(err as Error).message}`);
    return 1;
  }
  if (resp.action !== "pending" || !resp.ok) {
    console.error(`[vigili-cli] daemon が pending を返しませんでした: ${JSON.stringify(resp)}`);
    return 1;
  }
  if (resp.pending.length === 0) {
    console.log("(no pending requests)");
    return 0;
  }
  for (const r of resp.pending) {
    const age = Math.floor((Date.now() - r.created_at) / 1000);
    console.log(
      `${r.id}  +${age}s  ${r.session_tag ?? "?"}  ${r.tool_name}  ${summarize(r.tool_name, r.tool_input)}`,
    );
  }
  return 0;
}

function stats(args: string[]): number {
  const json = args.includes("--json");
  const sinceIdx = args.indexOf("--since");
  const sinceArg = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;
  const now = Date.now();
  let from: number;
  let label: string;
  if (sinceArg) {
    const ms = parseDuration(sinceArg);
    if (ms === null) {
      console.error(`invalid --since: ${sinceArg} (try 1h, 6h, 24h, 7d)`);
      return 1;
    }
    from = now - ms;
    label = `past ${sinceArg}`;
  } else {
    // --today (default): 今日のローカル 00:00 から
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    from = d.getTime();
    label = `today (since ${d.toLocaleString()})`;
  }

  const p = paths();
  const store = openStore(p.db);
  try {
    const { db } = store.raw();
    const s = computeStats(db, from, now);
    if (json) {
      console.log(JSON.stringify(s, null, 2));
      return 0;
    }
    printStats(s, label);
    return 0;
  } finally {
    store.close();
  }
}

function parseDuration(s: string): number | null {
  const m = /^(\d+)([smhd])$/u.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return null;
}

function printStats(s: StatsBuckets, label: string): void {
  const pct = (n: number): string =>
    s.total > 0 ? `${((n / s.total) * 100).toFixed(1)}%` : "—";
  const pad = (n: number | string, w = 6): string => String(n).padStart(w, " ");

  console.log(`\nsentinel stats — ${label}`);
  console.log("─".repeat(48));
  console.log(`Total decisions:        ${pad(s.total)}`);
  console.log(`  allow                 ${pad(s.by_decision.allow)}  ${pct(s.by_decision.allow)}`);
  console.log(`  deny                  ${pad(s.by_decision.deny)}  ${pct(s.by_decision.deny)}`);
  if (s.by_decision.pending > 0) {
    console.log(`  pending               ${pad(s.by_decision.pending)}`);
  }

  console.log("\nBy source:");
  const sourceLabels: Array<[keyof typeof s.by_source, string]> = [
    ["auto-rule", "rule (policy.yaml)"],
    ["invariant", "invariant (hardcoded)"],
    ["auto-default", "default (catch-all)"],
    ["human-pwa", "human (PWA)"],
    ["human-cli", "human (CLI)"],
    ["timeout", "timeout"],
    ["cancelled", "cancelled (gate disconnect)"],
    ["other", "other"],
  ];
  for (const [key, name] of sourceLabels) {
    const n = s.by_source[key];
    if (n === 0) continue;
    console.log(`  ${name.padEnd(28, " ")}  ${pad(n)}  ${pct(n)}`);
  }

  const h = s.human_response_ms;
  if (h.count > 0) {
    console.log("\nHuman response time:");
    console.log(`  median                ${pad(formatMs(h.p50))}`);
    console.log(`  mean                  ${pad(formatMs(h.mean))}`);
    console.log(`  p95                   ${pad(formatMs(h.p95))}`);
    console.log(`  max                   ${pad(formatMs(h.max))}`);
    console.log(`  samples               ${pad(h.count)}`);
  }

  const topTools = Object.entries(s.by_tool).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (topTools.length > 0) {
    console.log("\nTop tools:");
    for (const [tool, n] of topTools) {
      console.log(`  ${tool.padEnd(28, " ")}  ${pad(n)}`);
    }
  }

  const topTags = Object.entries(s.by_tag).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topTags.length > 0) {
    console.log("\nTop sessions:");
    for (const [tag, n] of topTags) {
      console.log(`  ${tag.padEnd(28, " ")}  ${pad(n)}`);
    }
  }
  console.log("");
}

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

async function resolve(decision: FinalDecision, args: string[]): Promise<number> {
  const id = args[0];
  if (!id) {
    console.error(`usage: sentinel-cli ${decision === "allow" ? "approve" : "deny"} <id> [reason]`);
    return 1;
  }
  const reason = args.slice(1).join(" ") || undefined;

  const p = paths();
  let resp: AdminResponse;
  try {
    resp = await sendAdmin(p.socket, {
      kind: "admin",
      action: "resolve",
      id,
      decision,
      ...(reason !== undefined ? { reason } : {}),
    });
  } catch (err) {
    console.error(`[vigili-cli] daemon に接続できません: ${(err as Error).message}`);
    return 1;
  }
  if (resp.action === "resolve" && resp.ok) {
    console.log(`${decision === "allow" ? "approved" : "denied"} ${id}`);
    return 0;
  }
  if (resp.action === "resolve") {
    console.error(`[vigili-cli] daemon が拒否: ${resp.error ?? "(no error message)"}`);
    return 1;
  }
  console.error(`[vigili-cli] 想定外の response: ${JSON.stringify(resp)}`);
  return 1;
}

/**
 * iPhone アプリの Setup を QR スキャン 1 回で済ませる用。
 *
 * デフォルトは `sentinel://setup?u=...&t=...` の URL を QR にする。
 * これだと iPhone 標準のカメラ.app からも認識して「Sentinel で開く」が出るので、
 * アプリ内のスキャナ経由でも、標準カメラ経由でもどちらも使える。
 *
 * --json で `{"u":..., "t":...}` の JSON ペイロード (旧形式) を埋める。
 *
 * QR のセル数を抑えるため短いキー (u, t) を使う。
 */
async function setupQr(args: string[]): Promise<number> {
  const urlIdx = args.indexOf("--url");
  const explicitUrl = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const plain = args.includes("--plain");
  const useJson = args.includes("--json");

  const p = paths();

  // token を読む
  let token: string;
  try {
    const { readFileSync } = await import("node:fs");
    token = readFileSync(p.token, "utf-8").trim();
  } catch (err) {
    console.error(`[vigili-cli] token を読めません: ${(err as Error).message}`);
    console.error(`(daemon を一度起動すると ${p.token} が生成されます)`);
    return 1;
  }

  // URL を取得 (--url か Tailscale 自動検出)
  let url: string;
  if (explicitUrl) {
    url = explicitUrl;
  } else {
    const detected = await detectPublicHost();
    if (!detected) {
      console.error(
        "[vigili-cli] LAN IP / Tailscale FQDN を自動検出できません。--url で明示してください。",
      );
      return 1;
    }
    url = detected;
  }

  const payload = useJson
    ? JSON.stringify({ u: url, t: token })
    : `sentinel://setup?u=${encodeURIComponent(url)}&t=${encodeURIComponent(token)}`;

  if (plain) {
    console.log(payload);
    return 0;
  }

  console.log("");
  console.log("  Scan this QR with iPhone Camera or Sentinel app:");
  console.log("");
  const mod = await import("qrcode-terminal");
  const qr = (mod.default ?? mod) as { generate: (text: string, opts?: { small?: boolean }, cb?: (output: string) => void) => void };
  qr.generate(payload, { small: true }, (output) => {
    console.log(output);
  });
  console.log("");
  console.log(`  URL:    ${url}`);
  console.log(`  Token:  ${token.slice(0, 8)}…${token.slice(-4)} (${token.length} chars)`);
  console.log(`  Format: ${useJson ? "JSON payload" : "sentinel:// URL (works with iPhone Camera.app too)"}`);
  console.log("");
  return 0;
}

/**
 * `sentinel://setup?u=...&t=...` の URL を組み立てて出力する。
 *
 * AirDrop / iMessage で iPhone に送り、タップすると Sentinel iOS app が起動して
 * 設定 + 接続が一気に進む (Setup 画面のスキップ)。
 *
 * --copy で pbcopy 経由でクリップボードに入れる (Universal Clipboard で iPhone でもペースト可)。
 * --open で macOS open(1) を叩いてその場で開く動作確認用。
 */
async function setupLink(args: string[]): Promise<number> {
  const urlIdx = args.indexOf("--url");
  const explicitUrl = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const copy = args.includes("--copy");
  const openIt = args.includes("--open");

  const p = paths();
  let token: string;
  try {
    const { readFileSync } = await import("node:fs");
    token = readFileSync(p.token, "utf-8").trim();
  } catch (err) {
    console.error(`[vigili-cli] token を読めません: ${(err as Error).message}`);
    return 1;
  }

  let url: string;
  if (explicitUrl) {
    url = explicitUrl;
  } else {
    const detected = await detectPublicHost();
    if (!detected) {
      console.error(
        "[vigili-cli] LAN IP / Tailscale FQDN を自動検出できません。--url で明示してください。",
      );
      return 1;
    }
    url = detected;
  }

  const link =
    `sentinel://setup?u=${encodeURIComponent(url)}&t=${encodeURIComponent(token)}`;

  console.log(link);

  if (copy) {
    await pbcopy(link);
    console.error("(copied to clipboard — paste on iPhone via Universal Clipboard)");
  }
  if (openIt) {
    const { spawn } = await import("node:child_process");
    spawn("/usr/bin/open", [link], { stdio: "inherit" });
  }
  return 0;
}

async function pbcopy(text: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const proc = spawn("/usr/bin/pbcopy");
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`pbcopy exit ${code}`))));
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

/**
 * 公開ホスト名 (iPhone から見えるホスト) を決定する。ポート込みで返す。
 *
 * 優先順位:
 *  1. en0 の LAN IP (`192.168.x.x:7878`) — 同 LAN にいる前提なら最速・確実
 *  2. Tailscale Self.DNSName (TLS 終端で :443 想定なのでポートなし) — 外出先用
 *
 * どちらも取れなければ null。
 */
async function detectPublicHost(): Promise<string | null> {
  const lan = await detectLanIp();
  if (lan) return `${lan}:7878`;
  return await detectTailscaleHost();
}

/**
 * `os.networkInterfaces()` から最初に見つかった IPv4 LAN IP を返す。
 * loopback / link-local は除外。
 */
async function detectLanIp(): Promise<string | null> {
  const { networkInterfaces } = await import("node:os");
  const ifaces = networkInterfaces();
  // en0 を最優先
  const order = ["en0", "en1", "en2", "en3"];
  const keys = Object.keys(ifaces).sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai < 0 && bi < 0) return a.localeCompare(b);
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  });
  for (const name of keys) {
    const addrs = ifaces[name];
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue; // APIPA
      return a.address;
    }
  }
  return null;
}

/**
 * `tailscale status --json` を呼んで Self.DNSName を取る。
 * Tailscale が無い / 未ログインなら null。
 */
async function detectTailscaleHost(): Promise<string | null> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    // tailscale バイナリの場所は homebrew のどちらか
    const candidates = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "tailscale"];
    let idx = 0;
    const tryNext = (): void => {
      if (idx >= candidates.length) {
        resolve(null);
        return;
      }
      const bin = candidates[idx++] as string;
      const child = spawn(bin, ["status", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d: Buffer) => { out += d.toString("utf-8"); });
      child.on("error", () => tryNext());
      child.on("exit", (code) => {
        if (code !== 0) { tryNext(); return; }
        try {
          const parsed = JSON.parse(out) as { Self?: { DNSName?: string } };
          const dns = parsed.Self?.DNSName ?? "";
          const cleaned = dns.replace(/\.$/u, "");
          resolve(cleaned.length > 0 ? cleaned : null);
        } catch {
          resolve(null);
        }
      });
    };
    tryNext();
  });
}

async function reload(): Promise<number> {
  const p = paths();
  let resp: AdminResponse;
  try {
    resp = await sendAdmin(p.socket, { kind: "admin", action: "reload" });
  } catch (err) {
    console.error(`[vigili-cli] daemon に接続できません: ${(err as Error).message}`);
    return 1;
  }
  if (resp.action === "reload" && resp.ok) {
    console.log(`policy reloaded (${resp.rules ?? "?"} rules)`);
    return 0;
  }
  console.error(`[vigili-cli] reload 失敗: ${JSON.stringify(resp)}`);
  return 1;
}

function sendAdmin(socketPath: string, payload: unknown): Promise<AdminResponse> {
  return new Promise((resolve, reject) => {
    const conn = createConnection(socketPath);
    let buf = "";
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error("daemon が応答しません (timeout 2s)"));
    }, 2000);
    conn.on("connect", () => {
      conn.write(`${JSON.stringify(payload)}\n`);
    });
    conn.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      const line = buf.slice(0, nl);
      conn.end();
      try {
        const parsed = JSON.parse(line);
        const result = AdminResponseSchema.safeParse(parsed);
        if (!result.success) {
          reject(new Error(`不正な daemon 応答: ${line}`));
          return;
        }
        resolve(result.data);
      } catch (err) {
        reject(err);
      }
    });
    conn.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function summarize(tool: string, input: Record<string, unknown>): string {
  if (tool === "Bash" && typeof input.command === "string") {
    return truncate(input.command, 80);
  }
  if ((tool === "Edit" || tool === "Write") && typeof input.file_path === "string") {
    return truncate(input.file_path, 80);
  }
  if (tool === "WebFetch" && typeof input.url === "string") {
    return truncate(input.url, 80);
  }
  return truncate(JSON.stringify(input), 80);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// 未使用変数の警告抑止 (TS noUnused* 用)。
void ({} as ApprovalRequest);

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
